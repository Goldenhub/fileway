const KEYWORDS = new Set([
  "import", "from", "export", "default", "const", "let", "var", "new",
  "async", "await", "return", "function", "class", "extends", "implements",
  "interface", "type", "void", "if", "else", "for", "of", "in", "while",
  "do", "switch", "case", "break", "continue", "throw", "try", "catch",
  "finally", "true", "false", "null", "undefined", "this", "typeof",
  "instanceof", "as", "with",
]);

const PUNCTUATION = new Set(["{", "[", "]", "}", "(", ")", "=>", "..."]);

const OPERATORS = new Set([
  "=", "==", "===", "!", "!=", "!==", "+", "+=", "-", "-=", "*",
  "*=", "/", "/=", "%", "%=", "&", "&&", "|", "||", "^", "^=",
  "~", "?:", "?.",
]);

function tokenize(code: string) {
  const tokens: { text: string; type?: string }[] = [];
  let i = 0;

  while (i < code.length) {
    // Skip whitespace
    if (/^\s$/.test(code[i]!)) {
      let ws = "";
      while (i < code.length && /^\s$/.test(code[i]!)) ws += code[i++];
      tokens.push({ text: ws });
      continue;
    }

    // Line comment
    if (code[i] === "/" && i + 1 < code.length && code[i + 1] === "/") {
      let text = "";
      while (i < code.length && code[i] !== "\n") text += code[i++];
      tokens.push({ text, type: "comment" });
      continue;
    }

    // Block comment
    if (
      code[i] === "/" && i + 1 < code.length && code[i + 1] === "*"
    ) {
      let text = "/*";
      i += 2;
      while (i + 1 < code.length && !(code[i] === "*" && code[i + 1] === "/")) {
        text += code[i++];
      }
      if (i + 1 < code.length) {
        text += "*/";
        i += 2;
      }
      tokens.push({ text, type: "comment" });
      continue;
    }

    // Template literal
    if (code[i] === "`") {
      let text = "`";
      i++;
      while (i < code.length && code[i] !== "`") {
        if (code[i] === "\\") text += code[i++] + (code[i] ?? "");
        else text += code[i];
        i++;
      }
      text += "`";
      i++;
      tokens.push({ text, type: "string" });
      continue;
    }

    // String literal (single or double quote)
    if (code[i] === '"' || code[i] === "'") {
      const quote = code[i]!;
      let text = quote;
      i++;
      while (i < code.length && code[i] !== quote) {
        if (code[i] === "\\") text += code[i++] + (code[i] ?? "");
        else text += code[i];
        i++;
      }
      text += quote;
      i++;
      tokens.push({ text, type: "string" });
      continue;
    }

    // Punctuation
    const twoChar = code[i] + (code[i + 1] ?? "");
    if (PUNCTUATION.has(twoChar)) {
      tokens.push({ text: twoChar, type: "punctuation" });
      i += 2;
      continue;
    }
    if (PUNCTUATION.has(code[i]!)) {
      tokens.push({ text: code[i]!, type: "punctuation" });
      i++;
      continue;
    }

    // Operators
    if (OPERATORS.has(twoChar)) {
      tokens.push({ text: twoChar, type: "operator" });
      i += 2;
      continue;
    }
    if (OPERATORS.has(code[i]!)) {
      tokens.push({ text: code[i]!, type: "operator" });
      i++;
      continue;
    }

    // Numbers
    if (/^\d$/.test(code[i]!)) {
      let num = "";
      while (i < code.length && /^[\d.]$/.test(code[i]!)) num += code[i++];
      tokens.push({ text: num, type: "number" });
      continue;
    }

    // Identifiers
    if (/^[a-zA-Z_$]$/.test(code[i]!)) {
      let word = "";
      while (i < code.length && /^[a-zA-Z0-9_$]$/.test(code[i]!)) {
        word += code[i++];
      }
      if (KEYWORDS.has(word)) {
        tokens.push({ text: word, type: "keyword" });
      } else if (/^[A-Z]/.test(word)) {
        tokens.push({ text: word, type: "class" });
      } else {
        tokens.push({ text: word, type: "param" });
      }
      continue;
    }

    // Everything else
    tokens.push({ text: code[i]! });
    i++;
  }

  return tokens;
}

const colors: Record<string, string> = {
  keyword: "#F97583",
  string: "#9ECBFF",
  number: "#79B8FF",
  class: "#B392F0",
  operator: "#F97583",
  punctuation: "#E1E4E8",
  param: "#FFAB70",
  comment: "#6A737D",
};

export function CodeBlock({
  code,
  dimmed,
}: {
  code: string;
  dimmed?: boolean;
}) {
  const tokens = tokenize(code);
  const baseColor = dimmed ? "#6A737D" : "#E1E4E8";
  return (
    <code>
      {tokens.map((t, i) => (
        <span key={i} style={{ color: t.type ? colors[t.type] : baseColor }}>
          {t.text}
        </span>
      ))}
    </code>
  );
}
