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
  { value: "union", label: "Union (\\union)" },
  { value: "intersect", label: "Intersect (\\intersect)" },
  { value: "diff", label: "Difference (\\diff)" },
];

const state = {
  schema: [],
  databasePath: "",
  builder: null,
  focusedRelationPath: null,
};

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

function cloneNode(node) {
  return JSON.parse(JSON.stringify(node));
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
}

function renderBuilder() {
  builderRoot.replaceChildren(renderExprNode(state.builder, "root", "Root expression"));
  syncBuilderToEditor();
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
  const response = await fetch("/api/schema");
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "failed to load schema");
  }

  state.databasePath = payload.database_path;
  state.schema = payload.relations;
  renderSchema();
  renderSamples();

  state.builder = defaultBuilder();
  renderBuilder();
}

async function runQuery() {
  hideError();
  resultsSummary.textContent = "Running query…";

  try {
    const response = await fetch("/api/run", {
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
document.getElementById("clear-all").addEventListener("click", () => {
  queryEditor.value = "";
  hideError();
  clearResults();
});

document.getElementById("load-sample").addEventListener("click", () => {
  const sample = SAMPLE_QUERIES[Number(sampleQuerySelect.value) || 0];
  queryEditor.value = sample.query;
  hideError();
  clearResults("Sample query loaded. Run it to see output tuples.");
});

document.addEventListener("DOMContentLoaded", async () => {
  clearResults();
  renderSamples();

  try {
    await loadSchema();
  } catch (error) {
    showError(error.message);
    generatedQuery.textContent = "Unable to load schema.";
  }
});
