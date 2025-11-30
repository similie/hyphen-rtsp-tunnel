/**
 * SimilieQuery — a safe, human-friendly mini rule language for JSON filtering.
 */
export class SimilieQuery {
  /**
   * Interpolates placeholders like {device.identity} or {config.apn}
   * in a string or object template using deep path lookup.
   *
   * Supports nested objects, arrays, and strings.
   * Escaped braces {{ ... }} are preserved.
   *
   * @example
   * const tpl = "Device={device.identity} APN={config.apn}";
   * SimilieQuery.interpolate(tpl, { device: { identity: "A1" }, config: { apn: "timor" } });
   * // → "Device=A1 APN=timor"
   */
  public static interpolate(template: any, data: Record<string, any>): any {
    // recursively walk through arrays and objects
    if (Array.isArray(template)) {
      return template.map((v) => this.interpolate(v, data));
    }
    if (template && typeof template === "object") {
      const result: Record<string, any> = {};
      for (const [k, v] of Object.entries(template)) {
        result[k] = this.interpolate(v, data);
      }
      return result;
    }

    // only interpolate strings
    if (typeof template !== "string") return template;

    // Replace escaped {{ ... }} → keep braces
    const escapeToken = "__ESCAPED_BRACE__";
    template = template.replace(
      /\{\{(.*?)\}\}/g,
      (_, inner) => `{${inner}}${escapeToken}`,
    );

    // Match {path.to.value}
    return template
      .replace(/\{([\w.[\]0-9_-]+)\}/g, (_, path) => {
        const value = this.get(data, path);
        return value !== undefined && value !== null ? String(value) : "";
      })
      .replace(new RegExp(escapeToken, "g"), ""); // clean escape markers
  }
  /**
   *
   * @param obj The object to query
   * @param path The path to the property, e.g. "a.b[0].c"
   * @param defaultValue The value to return if the path does not exist
   * @returns The value at the specified path or the default value if not found
   *
   * @example
   * const data = { device: { identity: "abc123", info: [{ name: "sensor1" }] } };
   * console.log(get(data, "device.identity"));          // "abc123"
   * console.log(get(data, "device.info[0].name"));      // "sensor1"
   * console.log(get(data, "device.info[1].name", "N/A"));// "N/A"
   */
  public static get(obj: any, path: string, defaultValue?: any): any {
    if (!obj || typeof path !== "string") return defaultValue;
    // Split by dots but support bracket syntax like "a[0].b"
    const keys = path
      .replace(/\[(\w+)\]/g, ".$1") // convert [0] → .0
      .replace(/^\./, "") // strip leading dot
      .split(".");
    let result = obj;
    for (const key of keys) {
      if (result != null && Object.prototype.hasOwnProperty.call(result, key)) {
        result = result[key];
      } else {
        return defaultValue;
      }
    }
    return result;
  }
  static evaluate(expr: string, data: Record<string, any>): boolean {
    if (!expr || !expr.trim()) return true;
    const tokens = this.tokenize(expr);
    const ast = this.parse(tokens);
    return this.execute(ast, data);
  }

  // ---------------- TOKENIZER ----------------
  private static tokenize(input: string) {
    const re =
      /\s*(>=|<=|==|!=|>|<|IN|NOT IN|CONTAINS|NOT CONTAINS|\(|\)|AND|OR|[A-Za-z0-9_.]+|"[^"]*"|'[^']*'|\[[^\]]*\]|true|false|null)\s*/gi;
    return input.match(re)?.map((t) => t.trim()) ?? [];
  }

  // ---------------- PARSER ----------------
  private static parse(tokens: string[]) {
    let i = 0;

    const parseExpression = (): any => {
      let left = parseTerm();
      while (tokens[i] && /^OR$/i.test(tokens[i])) {
        const op = tokens[i++].toUpperCase();
        const right = parseTerm();
        left = { op, left, right };
      }
      return left;
    };

    const parseTerm = (): any => {
      let left = parseFactor();
      while (tokens[i] && /^AND$/i.test(tokens[i])) {
        const op = tokens[i++].toUpperCase();
        const right = parseFactor();
        left = { op, left, right };
      }
      return left;
    };

    const parseFactor = (): any => {
      if (tokens[i] === "(") {
        i++;
        const expr = parseExpression();
        i++; // skip ')'
        return expr;
      }

      const left = tokens[i++];
      const opParts: string[] = [];

      // support multi-word ops like "NOT IN"
      while (
        tokens[i] &&
        /^(NOT|IN|CONTAINS)$/i.test(tokens[i]) &&
        opParts.join(" ").toUpperCase() !== "NOT CONTAINS"
      ) {
        opParts.push(tokens[i++].toUpperCase());
        if (opParts.join(" ") === "NOT CONTAINS") break;
      }

      const op = opParts.length ? opParts.join(" ") : tokens[i++];

      const right = tokens[i++];
      return { op: op.toUpperCase(), left, right };
    };

    return parseExpression();
  }

  // ---------------- EXECUTOR ----------------
  private static execute(node: any, data: Record<string, any>): boolean {
    if (!node) return false;

    if (node.op === "AND")
      return this.execute(node.left, data) && this.execute(node.right, data);
    if (node.op === "OR")
      return this.execute(node.left, data) || this.execute(node.right, data);

    const leftVal = this.resolveValue(node.left, data);
    const rightVal = this.resolveValue(node.right, data);

    switch (node.op) {
      case "==":
        return leftVal == rightVal;
      case "!=":
        return leftVal != rightVal;
      case ">":
        return leftVal > rightVal;
      case ">=":
        return leftVal >= rightVal;
      case "<":
        return leftVal < rightVal;
      case "<=":
        return leftVal <= rightVal;
      case "IN":
        return Array.isArray(rightVal) ? rightVal.includes(leftVal) : false;
      case "NOT IN":
        return Array.isArray(rightVal) ? !rightVal.includes(leftVal) : true;
      case "CONTAINS":
        return this.contains(rightVal, leftVal);
      case "NOT CONTAINS":
        return !this.contains(rightVal, leftVal);
      default:
        return false;
    }
  }

  private static contains(container: any, value: any): boolean {
    if (typeof container === "string") return container.includes(value);
    if (Array.isArray(container)) return container.includes(value);
    return false;
  }

  private static resolveValue(token: string, data: Record<string, any>): any {
    if (token === undefined || token === null) return null;

    // Array literal
    if (/^\[.*\]$/.test(token)) {
      try {
        return JSON.parse(token.replace(/'/g, '"'));
      } catch {
        return [];
      }
    }

    // String literal
    if (/^".*"$|^'.*'$/.test(token)) return token.slice(1, -1); // remove quotes

    // Boolean
    if (/^(true|false)$/i.test(token)) return token.toLowerCase() === "true";

    // Null
    if (/^null$/i.test(token)) return null;

    // Number
    if (!isNaN(Number(token))) return Number(token);

    // Otherwise path lookup
    return this.get(data, token);
  }
}
