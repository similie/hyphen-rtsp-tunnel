import uvicorn
import logging
import shutil
import re
from fastapi import FastAPI, Request
import subprocess, requests, os, zipfile, asyncio, stat, textwrap
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)   # ensure your logger will log at DEBUG level
handler = logging.StreamHandler()
from time import sleep
# handler.setLevel(logging.DEBUG)   # handler must also allow DEBUG
# formatter = logging.Formatter('%(asctime)s | %(levelname)s | %(name)s | %(message)s')
# handler.setFormatter(formatter)
logger.addHandler(handler)
app = FastAPI()

def insert_ca_chain():
    os.makedirs("src/certs", exist_ok=True)

    intermediate_url = "https://letsencrypt.org/certs/lets-encrypt-r3.pem"
    root_url = "https://letsencrypt.org/certs/isrgrootx1.pem"

    def download(url):
        max_retries = 3
        for attempt in range(1, max_retries+1):
            try:
                r = requests.get(url, timeout=10)
                r.raise_for_status()
                return r.content
            except Exception as exc:
                print(f"[CA Download] Attempt {attempt} failed for {url}: {exc}")
                if attempt < max_retries:
                    sleep(2)
                else:
                    raise

    print("📡 Downloading R3 intermediate cert...")
    r3 = download(intermediate_url)

    print("📡 Downloading ISRG Root X1 cert...")
    root = download(root_url)

    chain_path = "src/certs/isrgrootx1.pem"
    print(f"📝 Writing chain to {chain_path}")

    # MUST BE: R3 FIRST, ROOT SECOND
    with open(chain_path, "wb") as f:
        f.write(r3.strip() + b"\n")
        f.write(root.strip() + b"\n")

    print("✅ CA chain updated successfully.")


def extract_build_path(script: str) -> str:
    """
    Extract the build path from the platformio.ini script.
    Looks for a line like: build_dir = /some/path
    """
    env_name = ""
    match = re.search(r"\[env:([a-zA-Z0-9_\-]+)\]", script)
    logger.info(f"Extracting build path from script, match: {match}")
    if match:
        env_name = match.group(1)
    else:
        # fallback or error
        raise ValueError("Environment name not found in script")
    
    if not env_name:
        raise ValueError("Environment name is empty")

    build_path = f".pio/build/{env_name}"
    return build_path

@app.post("/build")
async def build(request: Request):
    payload = await request.json()
    logger.info(f"Received build payload: {payload.keys()}")
    repo = payload["repository"]
    device = payload["device"]
    profile = payload["profile"]
    certs = payload["certificates"]

    # Use delete=False so the directory is *not* removed upon exit
    build_dir = os.path.join("/workspace", "debug_build_" + device["identity"])
    if os.path.exists(build_dir):
        try:
        # remove the directory and all its contents
            shutil.rmtree(build_dir)
        except Exception as e:
            logger.error(f"Could not remove build dir {build_dir}: {e}")
    os.makedirs(build_dir, exist_ok=True)
    os.chdir(build_dir)
    logger.info(f"DEBUG: Using tmpdir: {build_dir}")

    # 1️⃣ Clone repo
    ssh_path = os.path.join(build_dir, "id_rsa")
    key_raw = repo.get("sshKey", "")
    if key_raw:
        key = key_raw.strip().replace("\r\n", "\n")
        with open(ssh_path, "w", newline="\n") as keyfile:
            keyfile.write(key + "\n")
        os.chmod(ssh_path, stat.S_IRUSR | stat.S_IWUSR)
        ssh_dir = os.path.join(build_dir, ".ssh")
        os.makedirs(ssh_dir, exist_ok=True)
        with open(os.path.join(ssh_dir, "config"), "w", newline="\n") as cfg:
            cfg.write(textwrap.dedent("""\
                Host *
                    StrictHostKeyChecking no
                    UserKnownHostsFile /dev/null
            """))
        subprocess.run([
            "git", "config", "--global",
            "core.sshCommand",
            f"ssh -i {ssh_path} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
        ], check=True)
        logger.info(f"✅ SSH key configured at {ssh_path}")
    else:
        logger.info("ℹ️ No sshKey provided – assuming public repository access")

    subprocess.run(["git", "clone", "-b", repo["branch"], repo["url"], "repo"], check=True)
    os.chdir("repo")

    # 2️⃣ Inject platformio.ini
    script = profile["script"].format(device=device)
    
    with open("platformio.ini", "w", newline="\n") as f:
        f.write(script)
    
    cert_dir = os.path.join("src", "certs")
    os.makedirs(cert_dir, exist_ok=True)
    for name, content in certs.items():
        filepath = os.path.join(cert_dir, name)
        with open(filepath, "w", encoding="utf-8", newline="\n") as f:
            f.write(content)
        logger.info(f"✅ Wrote certificate: {filepath} ({len(content)} bytes)")
        
    insert_ca_chain()

    # 4️⃣ Run build
    proc = await asyncio.create_subprocess_shell(
        "pio run && pio run -t buildfs -v",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    async for line in proc.stdout:
        logger.info(line.decode().rstrip())
    await proc.wait()

    # 5️⃣ Package artifacts
    os.makedirs("/workspace/build", exist_ok=True)
    zip_name = f"{device['identity']}.zip"
    zip_path = os.path.join("/workspace/build", zip_name)

    build_path = ".pio/build/esp32dev"
    try:
        build_path = extract_build_path(script)
    except Exception as e:
        logger.error(f"Could not extract build path from script: {e}. Using default path.")
    with zipfile.ZipFile(zip_path, "w") as out:
        for f_name in ["bootloader.bin", "partitions.bin", "firmware.bin", "spiffs.bin"]:
            path = os.path.join(build_path, f_name)
            if os.path.exists(path):
                out.write(path, arcname=f_name)

    logger.info(f"✅ Build artifacts stored at {zip_path}")
    logger.info("🔍 You can inspect this directory inside the container or at /tmp/similie-builds/<buildId> on host")

    return {"status": "done", "artifact": zip_path}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8080)
