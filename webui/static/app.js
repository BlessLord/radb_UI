const SAMPLE_QUERIES = [
  {
    label: "Project student names",
    query: "\\project_{sname} Student;",
  },
  {
    label: "Select high GPA students",
    query: "\\select_{gpa > 3.7} Student;",
  },
  {
    label: "Natural join Student and Apply",
    query: "Student \\join Apply;",
  },
  {
    label: "Cross product Student and College",
    query: "Student \\cross College;",
  },
  {
    label: "Intersect student names with renamed colleges",
    query: "\\project_{sname} Student \\intersect \\rename_{sname} \\project_{cname} College;",
  },
  {
    label: "Project student and college after join",
    query: "\\project_{sname,cname} (Student \\join Apply);",
  },
];

const BINARY_TYPES = new Set([
  "natural_join",
  "theta_join",
  "cross",
  "union",
  "intersect",
  "diff",
]);

const TYPE_OPTIONS = [
  { value: "relation", label: "Relation" },
  { value: "project", label: "Projection (\\project)" },
  { value: "select", label: "Selection (\\select)" },
  { value: "rename", label: "Rename (\\rename)" },
  { value: "natural_join", label: "Natural Join (\\join)" },
  { value: "theta_join", label: "Theta Join (\\join_{cond})" },
  { value: "cross", label: "Cross Product (\\cross)" },
  { value: "union", label: "Union (\\union)" },
  { value: "intersect", label: "Intersect (\\intersect)" },
  { value: "diff", label: "Difference (\\diff)" },
];

const state = {
  schema: [],
  databasePath: "",
  databaseKind: "sample",
  sampleDatabase: null,
  uploadedDatabase: null,
  uploadRules: {
    max_bytes: 1024 * 1024,
    max_mb_text: "1 MB",
    required_extension: ".db",
  },
  builder: null,
  focusedRelationPath: null,
};

const databaseSourceStatus = document.getElementById("database-source-status");
const useSampleDbButton = document.getElementById("use-sample-db");
const uploadDbInput = document.getElementById("upload-db-input");
const uploadDbButton = document.getElementById("upload-db-button");
const uploadRulesText = document.getElementById("upload-rules");
const uploadFeedback = document.getElementById("upload-feedback");
const relationList = document.getElementById("relation-list");
const relationOptions = document.getElementById("relation-options");
const dbPath = document.getElementById("db-path");
const builderRoot = document.getElementById("builder-root");
const generatedQuery = document.getElementById("generated-query");
const queryEditor = document.getElementById("query-editor");
const errorPanel = document.getElementById("error-panel");
const errorText = document.getElementById("error-text");
const resultsSummary = document.getElementById("results-summary");
const resultsEmpty = document.getElementById("results-empty");
const resultsTableWrap = document.getElementById("results-table-wrap");
const resultsTable = document.getElementById("results-table");
const sampleQuerySelect = document.getElementById("sample-query-select");
const mathPreviewStatus = document.getElementById("math-preview-status");
const mathjaxStatus = document.getElementById("mathjax-status");
const unicodePreview = document.getElementById("unicode-preview");
const latexSource = document.getElementById("latex-source");
const latexRendered = document.getElementById("latex-rendered");

function cloneNode(node) {
  return JSON.parse(JSON.stringify(node));
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${bytes} bytes`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeLatexText(value) {
  return String(value)
    .replaceAll("\\", "\\textbackslash{}")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replaceAll("_", "\\_")
    .replaceAll("%", "\\%")
    .replaceAll("#", "\\#")
    .replaceAll("&", "\\&")
    .replaceAll("$", "\\$")
    .replaceAll("^", "\\^{}");
}

function readBraceContent(source, openBraceIndex) {
  if (source[openBraceIndex] !== "{") {
    throw new Error("expected opening brace");
  }

  let depth = 0;
  let content = "";

  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index];

    if (char === "{") {
      depth += 1;
      if (depth > 1) {
        content += char;
      }
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          content,
          endIndex: index + 1,
        };
      }
      content += char;
      continue;
    }

    content += char;
  }

  throw new Error("unclosed brace in relational algebra expression");
}

function tokenizeMathExpression(source) {
  const tokens = [];
  const unaryOperators = [
    { prefix: "\\project_{", type: "PROJECT" },
    { prefix: "\\select_{", type: "SELECT" },
    { prefix: "\\rename_{", type: "RENAME" },
    { prefix: "\\join_{", type: "THETA_JOIN" },
  ];
  const binaryOperators = [
    { prefix: "\\join", type: "JOIN" },
    { prefix: "\\cross", type: "CROSS" },
    { prefix: "\\union", type: "UNION" },
    { prefix: "\\intersect", type: "INTERSECT" },
    { prefix: "\\diff", type: "DIFF" },
  ];

  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (/\s/.test(char) || char === ";") {
      index += 1;
      continue;
    }

    if (char === "(") {
      tokens.push({ type: "LPAREN" });
      index += 1;
      continue;
    }

    if (char === ")") {
      tokens.push({ type: "RPAREN" });
      index += 1;
      continue;
    }

    let matched = false;
    for (const operator of unaryOperators) {
      if (source.startsWith(operator.prefix, index)) {
        const braceIndex = index + operator.prefix.length - 1;
        const { content, endIndex } = readBraceContent(source, braceIndex);
        tokens.push({ type: operator.type, arg: content.trim() });
        index = endIndex;
        matched = true;
        break;
      }
    }

    if (matched) {
      continue;
    }

    for (const operator of binaryOperators) {
      if (source.startsWith(operator.prefix, index)) {
        tokens.push({ type: operator.type });
        index += operator.prefix.length;
        matched = true;
        break;
      }
    }

    if (matched) {
      continue;
    }

    let endIndex = index;
    while (endIndex < source.length && !/[\s();\\]/.test(source[endIndex])) {
      endIndex += 1;
    }

    if (endIndex === index) {
      throw new Error(`unsupported token near "${source.slice(index, index + 12)}"`);
    }

    tokens.push({
      type: "RELATION",
      value: source.slice(index, endIndex),
    });
    index = endIndex;
  }

  return tokens;
}

function parseMathExpression(source) {
  const tokens = tokenizeMathExpression(source.trim());
  let index = 0;

  function peek() {
    return tokens[index] || null;
  }

  function consume(expectedType) {
    const token = peek();
    if (!token || token.type !== expectedType) {
      throw new Error(`expected ${expectedType}`);
    }
    index += 1;
    return token;
  }

  function parsePrimary() {
    const token = peek();

    if (!token) {
      throw new Error("incomplete expression");
    }

    if (token.type === "LPAREN") {
      consume("LPAREN");
      const expr = parseSetExpression();
      consume("RPAREN");
      return { kind: "group", expr };
    }

    if (token.type === "RELATION") {
      index += 1;
      return { kind: "relation", name: token.value };
    }

    if (["PROJECT", "SELECT", "RENAME"].includes(token.type)) {
      index += 1;
      return {
        kind: "unary",
        op: token.type,
        arg: token.arg,
        child: parsePrimary(),
      };
    }

    throw new Error("unsupported relational algebra form for live math preview");
  }

  function parseJoinExpression() {
    let node = parsePrimary();

    while (["JOIN", "THETA_JOIN", "CROSS"].includes(peek()?.type)) {
      const operator = peek();
      index += 1;
      node = {
        kind: "binary",
        op: operator.type,
        arg: operator.arg || "",
        left: node,
        right: parsePrimary(),
      };
    }

    return node;
  }

  function parseSetExpression() {
    let node = parseJoinExpression();

    while (["UNION", "INTERSECT", "DIFF"].includes(peek()?.type)) {
      const operator = peek();
      index += 1;
      node = {
        kind: "binary",
        op: operator.type,
        left: node,
        right: parseJoinExpression(),
      };
    }

    return node;
  }

  const ast = parseSetExpression();
  if (index !== tokens.length) {
    throw new Error("extra tokens remained after parsing");
  }
  return ast;
}

function precedence(node) {
  if (!node) {
    return -1;
  }
  if (node.kind === "group") {
    return 99;
  }
  if (node.kind === "relation") {
    return 4;
  }
  if (node.kind === "unary") {
    return 3;
  }
  if (node.op === "JOIN" || node.op === "THETA_JOIN" || node.op === "CROSS") {
    return 2;
  }
  return 1;
}

function wrapUnicodeOperand(node, parentPrecedence) {
  const rendered = renderUnicodeMath(node);
  if (node.kind === "group" || precedence(node) >= parentPrecedence) {
    return rendered;
  }
  return `<span class="math-expression">(</span>${rendered}<span class="math-expression">)</span>`;
}

function wrapLatexOperand(node, parentPrecedence) {
  const rendered = renderLatexMath(node);
  if (node.kind === "group" || precedence(node) >= parentPrecedence) {
    return rendered;
  }
  return `\\left(${rendered}\\right)`;
}

function renderUnicodeMath(node) {
  if (node.kind === "group") {
    return `<span class="math-expression">(</span>${renderUnicodeMath(node.expr)}<span class="math-expression">)</span>`;
  }

  if (node.kind === "relation") {
    return `<span class="math-identifier">${escapeHtml(node.name)}</span>`;
  }

  if (node.kind === "unary") {
    const symbol = {
      PROJECT: "π",
      SELECT: "σ",
      RENAME: "ρ",
    }[node.op];
    const child = node.child.kind === "group"
      ? renderUnicodeMath(node.child.expr)
      : renderUnicodeMath(node.child);
    const subscript = node.arg ? `<sub>${escapeHtml(node.arg)}</sub>` : "";
    return `<span class="math-expression"><span class="math-symbol">${symbol}</span>${subscript}<span class="math-expression">(</span>${child}<span class="math-expression">)</span></span>`;
  }

  const symbol = {
    JOIN: "⋈",
    THETA_JOIN: "⋈",
    CROSS: "×",
    UNION: "∪",
    INTERSECT: "∩",
    DIFF: "−",
  }[node.op];
  const subscript = node.arg ? `<sub>${escapeHtml(node.arg)}</sub>` : "";
  const currentPrecedence = precedence(node);
  const left = wrapUnicodeOperand(node.left, currentPrecedence);
  const right = wrapUnicodeOperand(node.right, currentPrecedence);
  return `${left} <span class="math-expression"><span class="math-symbol">${symbol}</span>${subscript}</span> ${right}`;
}

function renderLatexMath(node) {
  if (node.kind === "group") {
    return `\\left(${renderLatexMath(node.expr)}\\right)`;
  }

  if (node.kind === "relation") {
    return `\\mathsf{${escapeLatexText(node.name)}}`;
  }

  if (node.kind === "unary") {
    const symbol = {
      PROJECT: "\\pi",
      SELECT: "\\sigma",
      RENAME: "\\rho",
    }[node.op];
    const subscript = node.arg ? `_{\\text{${escapeLatexText(node.arg)}}}` : "";
    const child = node.child.kind === "group"
      ? renderLatexMath(node.child.expr)
      : renderLatexMath(node.child);
    return `${symbol}${subscript}\\left(${child}\\right)`;
  }

  const symbol = {
    JOIN: "\\bowtie",
    THETA_JOIN: "\\bowtie",
    CROSS: "\\times",
    UNION: "\\cup",
    INTERSECT: "\\cap",
    DIFF: "\\mathbin{-}",
  }[node.op];
  const subscript = node.arg ? `_{\\text{${escapeLatexText(node.arg)}}}` : "";
  const currentPrecedence = precedence(node);
  const left = wrapLatexOperand(node.left, currentPrecedence);
  const right = wrapLatexOperand(node.right, currentPrecedence);
  return `${left} ${symbol}${subscript} ${right}`;
}

function setMathJaxStatus(message) {
  mathjaxStatus.textContent = message;
}

function renderLatexSurface(latex) {
  if (!latex) {
    latexRendered.innerHTML = '<div class="math-fallback">Waiting for a complete query.</div>';
    return;
  }

  if (!window.MathJax || typeof window.MathJax.typesetPromise !== "function") {
    latexRendered.innerHTML = '<div class="math-fallback">MathJax is unavailable. The LaTeX source above is still usable.</div>';
    return;
  }

  latexRendered.innerHTML = `\\[${latex}\\]`;
  window.MathJax.typesetClear?.([latexRendered]);
  window.MathJax.typesetPromise([latexRendered]).catch(() => {
    latexRendered.innerHTML = '<div class="math-fallback">MathJax could not render this expression.</div>';
  });
}

function updateMathPreview(query) {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    mathPreviewStatus.textContent = "Live mathematical rendering for the current raw query.";
    unicodePreview.innerHTML = "Type a query to preview it here.";
    latexSource.textContent = "Type a query to generate LaTeX.";
    renderLatexSurface("");
    return;
  }

  try {
    const ast = parseMathExpression(trimmedQuery);
    const unicodeHtml = renderUnicodeMath(ast);
    const latex = renderLatexMath(ast);

    mathPreviewStatus.textContent = "Rendered from the current raw query editor.";
    unicodePreview.innerHTML = unicodeHtml;
    latexSource.textContent = latex;
    renderLatexSurface(latex);
  } catch (error) {
    mathPreviewStatus.textContent = "Complete a supported project/select/rename/join/cross/set expression to typeset it.";
    unicodePreview.textContent = trimmedQuery;
    latexSource.textContent = trimmedQuery;
    renderLatexSurface("");
  }
}

function relationNames() {
  return state.schema.map((relation) => relation.name);
}

function relationByName(name) {
  return state.schema.find((relation) => relation.name === name) || null;
}

function firstRelationName() {
  return relationNames()[0] || "";
}

function firstColumnForRelation(name) {
  const relation = relationByName(name);
  return relation && relation.columns.length ? relation.columns[0].name : "";
}

function firstNumericColumnForRelation(name) {
  const relation = relationByName(name);
  if (!relation) {
    return "";
  }
  const numericColumn = relation.columns.find((column) => column.type === "number");
  return numericColumn ? numericColumn.name : "";
}

function extractFirstRelation(node) {
  if (!node) {
    return "";
  }
  if (node.type === "relation") {
    return node.relation || "";
  }
  if (node.child) {
    return extractFirstRelation(node.child);
  }
  if (node.left) {
    return extractFirstRelation(node.left);
  }
  if (node.right) {
    return extractFirstRelation(node.right);
  }
  return "";
}

function createRelationNode(name = "") {
  return {
    type: "relation",
    relation: name || firstRelationName(),
  };
}

function suggestionForNode(node) {
  const relationName = extractFirstRelation(node) || firstRelationName();
  return {
    relationName,
    firstColumn: firstColumnForRelation(relationName) || "attr",
    numericColumn: firstNumericColumnForRelation(relationName) || "",
  };
}

function childSeed(node) {
  if (!node) {
    return createRelationNode();
  }
  if (node.child) {
    return cloneNode(node.child);
  }
  return cloneNode(node);
}

function leftSeed(node) {
  if (!node) {
    return createRelationNode();
  }
  if (node.left) {
    return cloneNode(node.left);
  }
  return cloneNode(node);
}

function rightSeed(node) {
  if (!node || !node.right) {
    const relationName = relationNames()[1] || firstRelationName();
    return createRelationNode(relationName);
  }
  return cloneNode(node.right);
}

function createNode(type, existing = null) {
  const suggestion = suggestionForNode(existing);
  const comparisonCondition = suggestion.numericColumn
    ? `${suggestion.numericColumn} > 0`
    : "1 = 1";

  switch (type) {
    case "relation":
      return createRelationNode(extractFirstRelation(existing));
    case "project":
      return {
        type,
        attrs: suggestion.firstColumn,
        child: childSeed(existing),
      };
    case "select":
      return {
        type,
        condition: comparisonCondition,
        child: childSeed(existing),
      };
    case "rename":
      return {
        type,
        relationAlias: "",
        attrs: suggestion.firstColumn ? `new_${suggestion.firstColumn}` : "new_attr",
        child: childSeed(existing),
      };
    case "natural_join":
      return {
        type,
        left: leftSeed(existing),
        right: rightSeed(existing),
      };
    case "theta_join":
      return {
        type,
        condition: "1 = 1",
        left: leftSeed(existing),
        right: rightSeed(existing),
      };
    case "cross":
      return {
        type,
        left: leftSeed(existing),
        right: rightSeed(existing),
      };
    case "union":
    case "intersect":
    case "diff":
      return {
        type,
        left: leftSeed(existing),
        right: rightSeed(existing),
      };
    default:
      return createRelationNode();
  }
}

function defaultBuilder() {
  const relationName = firstRelationName();
  if (!relationName) {
    return createRelationNode("");
  }
  return {
    type: "project",
    attrs: firstColumnForRelation(relationName) || "attr",
    child: createRelationNode(relationName),
  };
}

function getNode(path) {
  const parts = path.split(".").slice(1);
  let current = state.builder;
  for (const part of parts) {
    current = current[part];
  }
  return current;
}

function setNode(path, value) {
  if (path === "root") {
    state.builder = value;
    return;
  }

  const parts = path.split(".").slice(1);
  const leaf = parts.pop();
  let current = state.builder;
  for (const part of parts) {
    current = current[part];
  }
  current[leaf] = value;
}

function makeField(path, field, labelText, value, placeholder = "") {
  const wrapper = document.createElement("div");
  wrapper.className = "expr-field";

  const label = document.createElement("label");
  label.textContent = labelText;
  wrapper.appendChild(label);

  const input = document.createElement("input");
  input.type = "text";
  input.value = value || "";
  input.placeholder = placeholder;
  input.dataset.path = path;
  input.dataset.field = field;
  if (field === "relation") {
    input.className = "relation-input";
    input.setAttribute("list", "relation-options");
  }
  wrapper.appendChild(input);
  return wrapper;
}

function makeOperatorSelect(path, currentType) {
  const select = document.createElement("select");
  select.dataset.path = path;
  select.dataset.role = "operator";
  TYPE_OPTIONS.forEach((optionConfig) => {
    const option = document.createElement("option");
    option.value = optionConfig.value;
    option.textContent = optionConfig.label;
    option.selected = optionConfig.value === currentType;
    select.appendChild(option);
  });
  return select;
}

function renderSlot(title, childNode, path) {
  const slot = document.createElement("div");
  slot.className = "expr-slot";

  const titleElement = document.createElement("p");
  titleElement.className = "expr-slot-title";
  titleElement.textContent = title;
  slot.appendChild(titleElement);

  slot.appendChild(renderExprNode(childNode, path, title));
  return slot;
}

function renderExprNode(node, path, labelText = "Expression") {
  const card = document.createElement("section");
  card.className = "expr-card";

  const header = document.createElement("div");
  header.className = "expr-card-header";

  const label = document.createElement("div");
  label.className = "expr-label";
  label.textContent = labelText;
  header.appendChild(label);
  header.appendChild(makeOperatorSelect(path, node.type));
  card.appendChild(header);

  const fields = document.createElement("div");
  fields.className = "expr-grid";

  if (node.type === "relation") {
    fields.appendChild(
      makeField(path, "relation", "Relation name", node.relation, "Student")
    );
    card.appendChild(fields);
    return card;
  }

  if (node.type === "project") {
    fields.appendChild(
      makeField(path, "attrs", "Projected attributes", node.attrs, "sname,cname")
    );
    card.appendChild(fields);
    card.appendChild(renderSlot("Input relation", node.child, `${path}.child`));
    return card;
  }

  if (node.type === "select") {
    fields.appendChild(
      makeField(path, "condition", "Selection condition", node.condition, "gpa > 3.7")
    );
    card.appendChild(fields);
    card.appendChild(renderSlot("Input relation", node.child, `${path}.child`));
    return card;
  }

  if (node.type === "rename") {
    fields.appendChild(
      makeField(path, "relationAlias", "Relation alias (optional)", node.relationAlias, "s1")
    );
    fields.appendChild(
      makeField(path, "attrs", "Renamed attributes (optional)", node.attrs, "sname,cname")
    );
    card.appendChild(fields);
    card.appendChild(renderSlot("Input relation", node.child, `${path}.child`));
    return card;
  }

  if (node.type === "theta_join") {
    fields.appendChild(
      makeField(path, "condition", "Join condition", node.condition, "Student.sid = Apply.sid")
    );
    card.appendChild(fields);
  }

  const subexprGrid = document.createElement("div");
  subexprGrid.className = "subexpr-grid";
  subexprGrid.appendChild(renderSlot("Left input", node.left, `${path}.left`));
  subexprGrid.appendChild(renderSlot("Right input", node.right, `${path}.right`));
  card.appendChild(subexprGrid);
  return card;
}

function renameSpec(node) {
  const alias = (node.relationAlias || "").trim();
  const attrs = (node.attrs || "").trim();
  if (alias && attrs) {
    return `${alias}:${attrs}`;
  }
  if (alias) {
    return `${alias}:*`;
  }
  return attrs;
}

function wrapChild(node, rendered) {
  return BINARY_TYPES.has(node.type) ? `(${rendered})` : rendered;
}

function renderExpression(node) {
  if (!node) {
    return "";
  }

  if (node.type === "relation") {
    return (node.relation || "").trim();
  }

  if (node.type === "project") {
    const child = renderExpression(node.child);
    return `\\project_{${(node.attrs || "").trim()}} ${wrapChild(node.child, child)}`.trim();
  }

  if (node.type === "select") {
    const child = renderExpression(node.child);
    return `\\select_{${(node.condition || "").trim()}} ${wrapChild(node.child, child)}`.trim();
  }

  if (node.type === "rename") {
    const child = renderExpression(node.child);
    return `\\rename_{${renameSpec(node)}} ${wrapChild(node.child, child)}`.trim();
  }

  const left = renderExpression(node.left);
  const right = renderExpression(node.right);
  const leftExpr = wrapChild(node.left, left);
  const rightExpr = wrapChild(node.right, right);

  if (node.type === "natural_join") {
    return `${leftExpr} \\join ${rightExpr}`.trim();
  }

  if (node.type === "theta_join") {
    return `${leftExpr} \\join_{${(node.condition || "").trim()}} ${rightExpr}`.trim();
  }

  if (node.type === "cross") {
    return `${leftExpr} \\cross ${rightExpr}`.trim();
  }

  if (node.type === "union") {
    return `${leftExpr} \\union ${rightExpr}`.trim();
  }

  if (node.type === "intersect") {
    return `${leftExpr} \\intersect ${rightExpr}`.trim();
  }

  if (node.type === "diff") {
    return `${leftExpr} \\diff ${rightExpr}`.trim();
  }

  return "";
}

function builderQuery() {
  const expression = renderExpression(state.builder).trim();
  return expression ? `${expression};` : "";
}

function syncBuilderToEditor() {
  const query = builderQuery();
  generatedQuery.textContent = query || "Builder query will appear here.";
  queryEditor.value = query;
  updateMathPreview(query);
}

function renderBuilder() {
  builderRoot.replaceChildren(renderExprNode(state.builder, "root", "Root expression"));
  syncBuilderToEditor();
}

function renderDatabaseSource() {
  const activeLabel = state.databaseKind === "upload" && state.uploadedDatabase
    ? `Uploaded database: ${state.uploadedDatabase.label}`
    : `Sample database: ${state.sampleDatabase?.label || "college.db"}`;

  databaseSourceStatus.textContent = activeLabel;
  useSampleDbButton.disabled = state.databaseKind === "sample";
  uploadRulesText.textContent = `Only ${state.uploadRules.required_extension} files up to ${state.uploadRules.max_mb_text} are allowed.`;

  if (state.databaseKind === "upload" && state.uploadedDatabase) {
    uploadFeedback.textContent = `Current upload: ${state.uploadedDatabase.label}`;
  } else if (state.uploadedDatabase) {
    uploadFeedback.textContent = `Uploaded database available: ${state.uploadedDatabase.label}`;
  } else {
    uploadFeedback.textContent = "Uploads are scoped to your current browser session.";
  }
}

function renderSchema() {
  dbPath.textContent = state.databasePath;

  relationOptions.replaceChildren();
  relationList.replaceChildren();

  state.schema.forEach((relation) => {
    const option = document.createElement("option");
    option.value = relation.name;
    relationOptions.appendChild(option);

    const card = document.createElement("article");
    card.className = "relation-card";

    const header = document.createElement("div");
    header.className = "relation-card-header";

    const title = document.createElement("h3");
    title.textContent = relation.name;
    header.appendChild(title);

    const useButton = document.createElement("button");
    useButton.type = "button";
    useButton.className = "secondary-button";
    useButton.dataset.relation = relation.name;
    useButton.textContent = "Use";
    header.appendChild(useButton);

    card.appendChild(header);

    const columns = document.createElement("div");
    columns.className = "chip-row";
    relation.columns.forEach((column) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.innerHTML = `<strong>${column.name}</strong> <span>${column.type}</span>`;
      columns.appendChild(chip);
    });

    card.appendChild(columns);
    relationList.appendChild(card);
  });
}

function renderSamples() {
  sampleQuerySelect.replaceChildren();
  SAMPLE_QUERIES.forEach((sample, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = sample.label;
    sampleQuerySelect.appendChild(option);
  });
}

function resetWorkspaceForDatabaseChange(message = "Database ready. Build or run a query.") {
  state.builder = defaultBuilder();
  renderBuilder();
  hideError();
  clearResults(message);
}

function applySchemaPayload(payload, message = "Database ready. Build or run a query.") {
  state.databasePath = payload.active_database.path;
  state.databaseKind = payload.active_database.kind;
  state.sampleDatabase = payload.sample_database;
  state.uploadedDatabase = payload.uploaded_database;
  state.uploadRules = payload.upload_rules;
  state.schema = payload.relations;

  renderDatabaseSource();
  renderSchema();
  renderSamples();
  resetWorkspaceForDatabaseChange(message);
}

function showError(message) {
  errorText.textContent = message;
  errorPanel.classList.remove("hidden");
}

function hideError() {
  errorText.textContent = "";
  errorPanel.classList.add("hidden");
}

function clearResults(message = "Run a query to show output tuples.") {
  resultsSummary.textContent = message;
  resultsTable.innerHTML = "";
  resultsTableWrap.classList.add("hidden");
  resultsEmpty.classList.remove("hidden");
  resultsEmpty.textContent = "no tuples returned";
}

function renderResults(data) {
  resultsSummary.textContent = `${data.columns.length} column(s) • ${data.row_count} row(s)`;

  if (!data.rows.length) {
    resultsEmpty.classList.remove("hidden");
    resultsEmpty.textContent = "no tuples returned";
    resultsTableWrap.classList.add("hidden");
    resultsTable.innerHTML = "";
    return;
  }

  resultsEmpty.classList.add("hidden");
  resultsTableWrap.classList.remove("hidden");

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  data.columns.forEach((column) => {
    const th = document.createElement("th");
    th.textContent = `${column.name} (${column.type})`;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  const tbody = document.createElement("tbody");
  data.rows.forEach((row) => {
    const tr = document.createElement("tr");
    row.forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value === null ? "NULL" : String(value);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  resultsTable.replaceChildren(thead, tbody);
}

async function loadSchema() {
  const response = await fetch("api/schema");
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "failed to load schema");
  }
  applySchemaPayload(payload);
}

async function switchToSampleDatabase() {
  hideError();
  uploadFeedback.textContent = "Switching to the sample database…";

  try {
    const response = await fetch("api/database/sample", {
      method: "POST",
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "failed to switch database");
    }
    applySchemaPayload(payload, payload.message || "Sample database loaded.");
    uploadFeedback.textContent = payload.message || "Sample database loaded.";
  } catch (error) {
    showError(error.message);
    uploadFeedback.textContent = "Could not switch to the sample database.";
  }
}

async function uploadDatabase() {
  hideError();

  const file = uploadDbInput.files[0];
  if (!file) {
    showError("Choose a SQLite .db file before uploading.");
    return;
  }

  if (!file.name.toLowerCase().endsWith(state.uploadRules.required_extension)) {
    showError(`Uploaded database must use the ${state.uploadRules.required_extension} extension.`);
    return;
  }

  if (file.size > state.uploadRules.max_bytes) {
    showError(`Uploaded database exceeds the ${state.uploadRules.max_mb_text} limit.`);
    return;
  }

  uploadFeedback.textContent = `Uploading ${file.name}…`;
  const formData = new FormData();
  formData.append("database", file);

  try {
    const response = await fetch("api/database/upload", {
      method: "POST",
      body: formData,
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "failed to upload database");
    }
    applySchemaPayload(payload, payload.message || "Uploaded database loaded.");
    uploadFeedback.textContent = payload.message || `Uploaded ${file.name}.`;
    uploadDbInput.value = "";
  } catch (error) {
    showError(error.message);
    uploadFeedback.textContent = `Could not upload ${file.name}.`;
  }
}

async function runQuery() {
  hideError();
  resultsSummary.textContent = "Running query…";

  try {
    const response = await fetch("api/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: queryEditor.value }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "query failed");
    }
    renderResults(payload);
  } catch (error) {
    clearResults("Run a query to show output tuples.");
    showError(error.message);
  }
}

function resetBuilder() {
  state.builder = defaultBuilder();
  renderBuilder();
  hideError();
  clearResults();
}

builderRoot.addEventListener("focusin", (event) => {
  const target = event.target;
  if (target.dataset && target.dataset.field === "relation") {
    state.focusedRelationPath = target.dataset.path;
  }
});

builderRoot.addEventListener("input", (event) => {
  const target = event.target;
  if (!target.dataset || !target.dataset.path) {
    return;
  }

  const node = getNode(target.dataset.path);
  node[target.dataset.field] = target.value;
  syncBuilderToEditor();
});

builderRoot.addEventListener("change", (event) => {
  const target = event.target;
  if (target.dataset && target.dataset.role === "operator") {
    const currentNode = getNode(target.dataset.path);
    setNode(target.dataset.path, createNode(target.value, currentNode));
    renderBuilder();
  }
});

relationList.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.dataset.relation) {
    return;
  }

  const relation = target.dataset.relation;
  if (state.focusedRelationPath) {
    const node = getNode(state.focusedRelationPath);
    node.relation = relation;
  } else {
    state.builder = createRelationNode(relation);
  }
  renderBuilder();
});

document.getElementById("builder-reset").addEventListener("click", resetBuilder);
document.getElementById("run-query").addEventListener("click", runQuery);
useSampleDbButton.addEventListener("click", switchToSampleDatabase);
uploadDbButton.addEventListener("click", uploadDatabase);
document.getElementById("clear-all").addEventListener("click", () => {
  queryEditor.value = "";
  hideError();
  clearResults();
  updateMathPreview("");
});

uploadDbInput.addEventListener("change", () => {
  const file = uploadDbInput.files[0];
  if (!file) {
    uploadFeedback.textContent = "Uploads are scoped to your current browser session.";
    return;
  }
  uploadFeedback.textContent = `Selected ${file.name} (${formatBytes(file.size)}).`;
});

document.getElementById("load-sample").addEventListener("click", () => {
  const sample = SAMPLE_QUERIES[Number(sampleQuerySelect.value) || 0];
  queryEditor.value = sample.query;
  hideError();
  clearResults("Sample query loaded. Run it to see output tuples.");
  updateMathPreview(queryEditor.value);
});

queryEditor.addEventListener("input", () => {
  updateMathPreview(queryEditor.value);
});

window.addEventListener("mathjax-ready", () => {
  setMathJaxStatus("MathJax ready");
  updateMathPreview(queryEditor.value);
});

window.addEventListener("mathjax-error", () => {
  setMathJaxStatus("MathJax unavailable");
  updateMathPreview(queryEditor.value);
});

document.addEventListener("DOMContentLoaded", async () => {
  clearResults();
  renderSamples();
  updateMathPreview(queryEditor.value);
  if (!window.MathJax || typeof window.MathJax.typesetPromise !== "function") {
    setMathJaxStatus("MathJax loading…");
  }

  try {
    await loadSchema();
  } catch (error) {
    showError(error.message);
    generatedQuery.textContent = "Unable to load schema.";
  }
});
