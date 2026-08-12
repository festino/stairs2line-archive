import fs from 'node:fs/promises';

export function stripJsonComments(input) {
  let output = '';
  let inString = false;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (lineComment) {
      if (char === '\n') {
        lineComment = false;
        output += char;
      } else {
        output += ' ';
      }
      continue;
    }

    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        output += '  ';
        index += 1;
      } else {
        output += char === '\n' ? '\n' : ' ';
      }
      continue;
    }

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      output += char;
      continue;
    }

    if (char === '/' && next === '/') {
      lineComment = true;
      output += '  ';
      index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      blockComment = true;
      output += '  ';
      index += 1;
      continue;
    }

    output += char;
  }

  return output;
}

export function removeTrailingCommas(input) {
  let output = '';
  let inString = false;
  let quote = '';
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      output += char;
      continue;
    }

    if (char === ',') {
      let lookahead = index + 1;
      while (lookahead < input.length && /\s/.test(input[lookahead])) {
        lookahead += 1;
      }
      if (input[lookahead] === '}' || input[lookahead] === ']') {
        continue;
      }
    }

    output += char;
  }

  return output;
}

export function parseJsonc(input, sourceName = '<jsonc>') {
  try {
    return JSON.parse(removeTrailingCommas(stripJsonComments(input)));
  } catch (error) {
    throw new Error(`Could not parse ${sourceName}: ${error.message}`, { cause: error });
  }
}

export async function readJsonc(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return parseJsonc(content, filePath);
}

export async function writeJson(filePath, value, headerComment = null) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  const content = headerComment ? `// ${headerComment}\n${body}` : body;
  await fs.writeFile(filePath, content, 'utf8');
}
