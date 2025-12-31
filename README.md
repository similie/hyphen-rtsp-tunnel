# @similie/hyphen-rtsp-tunnel

**Secure, low-cost RTSP snapshot tunneling for distributed environmental monitoring**

---

## Why this exists

At **Similie**, we’re always looking for ways to make **low-cost technology have research-grade impact**.

Many communities—especially in emerging and climate-vulnerable regions—already have access to **consumer-grade IP cameras**. These cameras are affordable, reliable, and widely available, but they’re rarely designed to operate in:

- Intermittent connectivity environments
- Outside local area networks (LAN) infrastructures
- Horizontally scaled server architectures
- Scientific or humanitarian data pipelines

The outputs are often pushed to proprietary/paid services for home monitoring and security use cases. Similie seeks to bypass these limitations, by tapping into the RTSP outputs found on many consumer-grade cameras.

This project bridges the gap between cost, access, deployability, and open operability.

**`@similie/hyphen-rtsp-tunnel`** allows low-power edge devices (for example, ESP32-based gateways) to securely tunnel RTSP camera streams over WebSockets to a centralized server, capture snapshots, and feed them into modern processing pipelines—**without exposing cameras directly to the internet**.

The result:

> **Consumer hardware, safely integrated into professional-grade monitoring systems**

---

## What this module does

This package implements a **Hyphen Command Center plugin** that:

- Accepts **secure WebSocket connections** from edge devices
- Authenticates devices using a challenge-response handshake (pluggable)
- Creates a **temporary RTSP tunnel** over WebSockets
- Captures a snapshot using `ffmpeg`
- Emits structured events for downstream processing (storage, queues, AI, etc.)

Design constraints:

- The gateway **does not assume storage or cloud providers**
- The gateway **does not block on uploads**
- The gateway is **leader-aware** for horizontal scaling

---

## High-level architecture

```
┌─────────────┐
│ IP Camera   │
│ (RTSP)      │
└─────┬───────┘
│ 192.168.4.x (private AP)
┌─────▼───────┐
│ HyphenOS.   |
| Enabled     │
│ Device      │
│ (ESP32)     │
│             │
│ RTSP ↔ WSS  │
└─────┬───────┘
│ Secure WebSocket
▼
┌───────────────────────┐
│ Command Center API    │
│                       │
│  RTSP Tunnel Gateway  │
│   - ffmpeg snapshot   │
│   - auth handshake    │
│   - leader-aware      │
└─────────┬─────────────┘
│ events
▼
┌────────────────────────────┐
│ Storage / Queue / AI       │
│ (pluggable, async)         │
└────────────────────────────┘
```

---

## Key design principles

### 🔐 Secure by default

- Cameras are **never exposed** to the public internet
- RTSP traffic only flows inside a **temporary authenticated tunnel**
- Device authentication is **pluggable** (RSA, certificates, future identity systems)

### 🌍 Designed for constrained environments

- Works with **low-power devices**
- Handles **intermittent connectivity**
- Snapshot windows automatically clean up on failure

### ⚖️ Horizontally scalable

- Leader-aware via Redis-based leader election
- Only one gateway handles RTSP capture at a time
- Multiple servers can process downstream jobs

### 🧩 Modular & extensible

- Storage is event-driven, not hard-coded
- Queue notification is optional and pluggable
- Designed to integrate with broader data pipelines

---

## Installation

```bash
npm install @similie/hyphen-rtsp-tunnel
```

This package is designed to be used inside a Hyphen Command Center API instance.
It is not a standalone server binary.

---

## Requirements

This module spans **device firmware** (HyphenOS) and **server infrastructure** (Hyphen Command Center + ffmpeg). Make sure the full stack meets the minimum versions below.

### 1) Device Firmware (HyphenOS)

You need **HyphenOS v1.0.19+** with the IPCamera + WiFi AP feature enabled.

At minimum, your firmware build must include these `build_flags` (example shown using PlatformIO-style flags):

```ini
; --- Enable WiFi AP mode (camera LAN) ---
-D HYPHEN_WIFI_AP_ENABLE=1
-D HYPHEN_WIFI_AP_SSID=\"HyphenCam-001\"
-D HYPHEN_WIFI_AP_PASS=\"hyphen1234\"
-D HYPHEN_WIFI_AP_CHANNEL=6
-D HYPHEN_WIFI_AP_MAX_CLIENTS=4
-D HYPHEN_HIDE_WIFI_AP=0
; --- Camera endpoint on AP LAN ---
-D HYPHEN_CAM_HOST=\"192.168.4.216\"
-D HYPHEN_CAM_PORT=554

; --- WSS tunnel endpoint (Hyphen Command Center API) ---
-D HYPHEN_WSS_HOST=\"192.168.18.215\"
-D HYPHEN_WSS_PORT=7443
-D HYPHEN_WSS_PATH=\"/\"

; --- Snapshot cadence ---
-D HYPHEN_IPCAM_OFFSET_DEFAULT=1   ; (publish() cadence multiplier)
-D HYPHEN_IPCAM_TUNNEL_TIMEOUT_MS=45000

; --- AP static network (optional but recommended for determinism) ---
-D HYPHEN_WIFI_AP_IP_0=192
-D HYPHEN_WIFI_AP_IP_1=168
-D HYPHEN_WIFI_AP_IP_2=4
-D HYPHEN_WIFI_AP_IP_3=1

-D HYPHEN_WIFI_AP_MASK_0=255
-D HYPHEN_WIFI_AP_MASK_1=255
-D HYPHEN_WIFI_AP_MASK_2=255
-D HYPHEN_WIFI_AP_MASK_3=0
```

Notes:

- The camera is expected to be reachable on the Hyphen device’s AP LAN (e.g. 192.168.4.x).
- The WSS host/port/path are compiled into the device firmware, so the server does not “discover” the camera endpoint.

### 2) Hyphen Command Center Versions

This module is designed to run inside the Hyphen Command Center stack.

Minimum versions:

- Hyphen Command Center API v1.1.1+
- Hyphen Command Center (UI) v1.1.2+

You can override env variable defaults if you include the following in the IP Camera "Sensor" metadata in Command Center:

- CAM_PASS=admin
- CAM_USER=mycamerapassword
- RTSP_PATH=/stream2 # the RTSP stream to pull

### 3) Server Runtime: ffmpeg

The server process that hosts this plugin must have ffmpeg installed and available on the PATH (or wrapped in your runtime container image).
Quick install:

#### Ubuntu/Debian

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg
```

#### Fedora

```bash
sudo dnf install -y ffmpeg
```

#### macOS (Home)

```bash
brew install ffmpeg
```

#### Docker

If you run Command Center in containers, ensure your image includes ffmpeg (for Debian-based images):

```dockerfile
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
```

### 4) Optional: AWS SQS (Downstream notifications)

If you want the gateway to emit snapshot events to SQS, you must configure AWS credentials + region and provide:
• AWS_REGION
• SQS_QUEUE_URL

If these are not set, the SQS notifier remains disabled and the module still works normally.

---

## Quick Debugging Checklist

Before debugging code, verify these basics — **90% of issues show up here**.

### Device (HyphenOS)

- [ ] Device is running **HyphenOS v1.0.19+**
- [ ] WiFi AP is visible (e.g. `HyphenCam-001`)
- [ ] Camera is connected to the device AP
- [ ] Camera responds from the device:
  - RTSP reachable at `rtsp://<CAM_HOST>:<CAM_PORT><RTSP_PATH>`
- [ ] Device can resolve and reach the Command Center WSS host
- [ ] `HELLO` and `AUTH_OK` appear in Command Center logs

### Network

- [ ] **WSS port is reachable** from the device network
- [ ] No firewall blocking:
  - WebSocket port (`WS_PORT`)
  - Local proxy port (`PROXY_PORT`) on the server
- [ ] TLS certs are valid if `WS_TLS=1`

### Command Center API

- [ ] Running **Hyphen Command Center API v1.1.1+**
- [ ] Module `@similie/hyphen-rtsp-tunnel` is loaded at startup
- [ ] Redis is reachable (leader election + caching)
- [ ] Device identity exists and resolves correctly

### ffmpeg

- [ ] `ffmpeg` is installed and on `PATH`
- [ ] Running `ffmpeg -version` works in the same environment
- [ ] `ffmpeg` can open the RTSP proxy URL:
  ```bash
  ffmpeg -rtsp_transport tcp -i rtsp://127.0.0.1:8554/stream2 -frames:v 1 test.jpg
  ```
- No other capture is already in progress (single-capture lock)

### Storage / Output

- OUT_DIR exists and is writable
- Snapshot files appear on successful capture
- Downstream listeners (SQS, workers, etc.) are optional and non-blocking

## Usage: Command Center Plugin

```bash
# .env
HYPHEN_MODULES=@similie/hyphen-rtsp-tunnel-module # comma-separated for additional modules
```

## Environment Variables

The gateway is fully configured via environment variables.

## Environment Variables

All configuration for `@similie/hyphen-rtsp-tunnel` is provided via environment variables.

### Gateway & Networking

| Variable     | Default | Description                                       |
| ------------ | ------- | ------------------------------------------------- |
| `WS_PORT`    | `7443`  | Port for the WebSocket gateway                    |
| `WS_TLS`     | `0`     | Enable TLS for WebSocket server (`1` = HTTPS/WSS) |
| `TLS_CERT`   | —       | Path to TLS certificate (required if `WS_TLS=1`)  |
| `TLS_KEY`    | —       | Path to TLS private key (required if `WS_TLS=1`)  |
| `PROXY_PORT` | `8554`  | Local TCP proxy port used by FFmpeg               |

---

### RTSP / Camera

| Variable    | Default    | Description          |
| ----------- | ---------- | -------------------- |
| `CAM_USER`  | `admin`    | RTSP camera username |
| `CAM_PASS`  | —          | RTSP camera password |
| `RTSP_PATH` | `/stream2` | RTSP stream path     |

> **Note:**  
> The camera **host and port are NOT configured server-side**.  
> The ESP32 device determines the camera endpoint via its own build flags.

---

### Capture Behavior

| Variable             | Default | Description                                  |
| -------------------- | ------- | -------------------------------------------- |
| `AUTO_CAPTURE`       | `1`     | Automatically capture on device connection   |
| `CAPTURE_TIMEOUT_MS` | `45000` | Maximum capture duration before abort        |
| `HELLO_WAIT_MS`      | `2000`  | Time to wait for HELLO before closing socket |

---

### Authentication

| Variable       | Default | Description                           |
| -------------- | ------- | ------------------------------------- |
| `REQUIRE_AUTH` | `1`     | Require AUTH handshake before capture |

Authentication is currently based on Command Center/Device Certificate Signatures.

---

### Storage

| Variable  | Default           | Description                          |
| --------- | ----------------- | ------------------------------------ |
| `OUT_DIR` | OS temp directory | Local directory for snapshot storage |

---

### AWS / SQS (Optional)

These are only required if using the SQS notifier.

| Variable        | Description                    |
| --------------- | ------------------------------ |
| `AWS_REGION`    | AWS region                     |
| `SQS_QUEUE_URL` | SQS queue URL (FIFO supported) |

If these variables are not present, the notifier is automatically disabled.

---

## Device Handshake Flow

```
Server → READY
Device → HELLO [payloadId] deviceId
Server → CHAL
Device → AUTH deviceId
Server → AUTH_OK
Server → OPEN
```

---

## Events Emitted

The RTSP tunnel gateway exposes an internal event emitter so that **capture, storage, and downstream processing can be fully decoupled**.

### `snapshot:captured`

Emitted when a snapshot is successfully captured and written to local temporary storage.

```ts
{
  sessionId: string;
  deviceId: string;
  payloadId: string | null;
  localPath: string;
  capturedAt: string;
}
```

Typical consumers of this event include:

- Storage adapters (S3, NFS, local disk)
- Queue notifiers (SQS, BullMQ, Redis)
- Video stitching pipelines
- AI / image-processing workers (e.g. 4Shadow)

### `snapshot:failed`

Emitted whenever a snapshot attempt fails at any stage.

```ts
{
  stage: "auth" | "capture" | "timeout" | "ffmpeg";
  error: string;
}
```

This allows downstream systems to log, alert, retry, or back off without blocking the gateway.

---

## Storage Responsibility (Intentional Design)

We have stubbed out this plugin to work well for our workflows, but out of the box you may need to implement logic to
support your own workflows

This module does not:

- Upload images to S3 (without configuration)
- Push messages to SQS or Redis (without configuration)
- Persist database records
- Perform AI or video processing

The gateway’s responsibility ends at secure capture and local persistence.

This keeps the system:

- Non-blocking
- Fault tolerant
- Horizontally scalable
- Easy to extend with new pipelines

All heavy or slow work is expected to run in downstream workers.

---

## Scaling & High Availability

The RTSP tunnel is designed to operate in clustered environments:

- Uses leader election so only one instance captures
- Other nodes remain idle and ready for failover
- Safe to run behind load balancers
- Compatible with Redis-backed horizontal scaling

This avoids duplicate captures while preserving resilience.

---

## Security Model

Security is enforced through layered constraints:

- TLS-secured WebSocket transport
- Device-initiated outbound connections only
- Optional cryptographic authentication (nonce + signature)
- No inbound RTSP exposure
- Camera network remains isolated behind the device

This design minimizes attack surface and removes the need to expose cameras directly to the internet.

---

### Who This Is For

- Environmental sensing networks
- Flood and climate early-warning systems
- Research deployments using consumer-grade cameras
- Edge-to-cloud ingestion pipelines
- Teams who need secure camera access without RTSP exposure

---

## Philosophy

At Similie, we believe that low-cost, open technology can deliver research-grade impact.

This module is part of a broader effort to make climate monitoring, early warning, and environmental intelligence:

- Accessible
- Affordable
- Open
- Locally deployable
- Globally scalable

---

### License

MIT © Similie

### Hyphen Ecosystem

| Project                   | Description                                                                                                                       | Repository                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **HyphenOS**              | The device runtime environment for ultra-reliable IoT deployments. Includes OTA, telemetry queues, watchdogs, and sensor drivers. | https://github.com/similie/hyphen-os             |
| **HyphenConnect**         | Network + MQTT abstraction layer for ESP32 / Cellular devices. Enables function calls, variable access, and secure OTA.           | https://github.com/similie/hyphen-connect        |
| **Hyphen Command Center** | SvelteKit UI for managing your global device fleet, OTA updates, telemetry, and configuration.                                    | https://github.com/similie/hyphen-command-center |
| **Hyphen Elemental**      | The hardware schematics Similie uses to for our Hyphen Elemental 4 line of Products.                                              | https://github.com/similie/hyphen-elemental      |
| **Hyphen Video Encode**   | A video stream processor for the RTSP Camera Workflow. Turn snaps into daily images.                                              | https://github.com/similie/hyphen-videoencoder   |
| **Ellipsies**             | Workflow + routing engine powering the API: device identity, build pipeline, users, orgs, storage, and message routing.           | https://github.com/similie/ellipsies             |
