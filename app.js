let DATA = [];
let charts = {};

const $ = id => document.getElementById(id);

const money = n => new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2
}).format(n);

const uniq = a => [...new Set(a)].sort();

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (c === '"' && quoted && text[i + 1] === '"') {
      field += '"';
      i++;
    } else if (c === '"') {
      quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some(v => v.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift().map(h =>
    h.replace(/^\uFEFF/, "").trim().toLowerCase()
  );

  return rows.map(r => Object.fromEntries(
    headers.map((h, i) => [h, (r[i] || "").trim()])
  ));
}

function parseDate(value) {
  // Online Retail dates are typically M/D/YYYY HH:mm
  const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return "";

  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function setOptions(id, values) {
  const select = $(id);
  if (!select) return;

  const previous = select.value;
  select.querySelectorAll('option:not([value="all"])').forEach(o => o.remove());

  uniq(values.filter(Boolean)).forEach(v => {
    const option = document.createElement("option");
    option.value = v;
    option.textContent = v;
    select.appendChild(option);
  });

  select.value = [...select.options].some(o => o.value === previous)
    ? previous : "all";
}

function group(rows, key) {
  const result = {};
  rows.forEach(x => {
    const k = key(x);
    result[k] = (result[k] || 0) + x.revenue;
  });
  return result;
}

function draw(id, type, labels, values, opts = {}) {
  const canvas = $(id);
  if (!canvas || typeof Chart === "undefined") return;

  if (charts[id]) charts[id].destroy();

  charts[id] = new Chart(canvas, {
    type,
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: type === "line"
          ? "rgba(109,92,232,.16)"
          : opts.colors || "#42b99a",
        borderColor: type === "line" ? "#6d5ce8" : "transparent",
        fill: type === "line",
        tension: 0.35,
        borderRadius: 5,
        pointRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      indexAxis: opts.horizontal ? "y" : "x",
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "#8490a5" }
        },
        y: {
          beginAtZero: true,
          grid: { color: "#eef1f6" },
          ticks: { color: "#8490a5" }
        }
      }
    }
  });
}

function filtered() {
  const m = $("monthFilter").value;
  const c = $("countryFilter").value;
  const p = $("productFilter").value;
  const s = $("searchFilter").value.toLowerCase().trim();

  return DATA.filter(x =>
    (m === "all" || x.date.startsWith(m)) &&
    (c === "all" || x.country === c) &&
    (p === "all" || x.product === p) &&
    (!s || x.product.toLowerCase().includes(s) ||
      String(x.customer).includes(s))
  );
}

function render() {
  const rows = filtered();
  const total = rows.reduce((sum, x) => sum + x.revenue, 0);

  $("revenueKpi").textContent = money(total);
  $("ordersKpi").textContent =
    new Set(rows.map(x => x.invoice)).size.toLocaleString();
  $("customersKpi").textContent =
    new Set(rows.filter(x => x.customer !== null).map(x => x.customer)).size.toLocaleString();
  $("countriesKpi").textContent =
    new Set(rows.map(x => x.country).filter(Boolean)).size;

  const months = Object.entries(group(rows, x => x.date.slice(0, 7)))
    .sort((a, b) => a[0].localeCompare(b[0]));

  draw("monthlyChart", "line", months.map(x => x[0]), months.map(x => x[1]));

  const countries = Object.entries(group(rows, x => x.country))
    .sort((a, b) => b[1] - a[1]).slice(0, 7);

  draw("countryChart", "bar", countries.map(x => x[0]),
    countries.map(x => x[1]), {
      horizontal: true,
      colors: ["#6d5ce8", "#9184ef", "#afa5f6", "#c7c0fa",
        "#d9d4fc", "#8dd3bd", "#b4e4d5"]
    });

  const products = Object.entries(group(rows, x => x.product))
    .sort((a, b) => b[1] - a[1]).slice(0, 7);

  draw("productChart", "bar",
    products.map(x => x[0].length > 25 ? x[0].slice(0, 25) + "…" : x[0]),
    products.map(x => x[1]), { horizontal: true });

  const customers = {};
  rows.forEach(x => {
    if (x.customer !== null) {
      customers[x.customer] ??= { revenue: 0, invoices: new Set() };
      customers[x.customer].revenue += x.revenue;
      customers[x.customer].invoices.add(x.invoice);
    }
  });

  const top = Object.entries(customers)
    .sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 10);

  $("customerTable").innerHTML = top.length
    ? top.map(([id, v], i) =>
      `<tr><td>${i + 1}</td><td>${id}</td><td>${v.invoices.size}</td><td>${money(v.revenue)}</td></tr>`
    ).join("")
    : '<tr><td colspan="4">No matching customers</td></tr>';
}

async function loadData() {
  try {
    const response = await fetch("./online_retail.csv");
    if (!response.ok) {
      throw new Error("CSV file nahi mili. Check karo ki online_retail.csv project folder mein hai.");
    }

    const text = await response.text();
    const records = parseCSV(text);

    if (!records.length) throw new Error("CSV file khaali hai.");

    const required = ["invoiceno", "description", "quantity", "invoicedate", "unitprice", "country"];
    const headers = Object.keys(records[0]);
    const missing = required.filter(h => !headers.includes(h));

    if (missing.length) {
      throw new Error("CSV mein ye columns nahi mile: " + missing.join(", "));
    }

    DATA = records.map(r => {
      const quantity = Number(r.quantity);
      const unitPrice = Number(r.unitprice);
      const customerId = r.customerid;

      return {
        date: parseDate(r.invoicedate),
        country: r.country,
        product: r.description,
        customer: customerId ? customerId : null,
        invoice: r.invoiceno,
        quantity,
        unitPrice,
        revenue: quantity * unitPrice
      };
    }).filter(x =>
      x.date && x.product && x.country &&
      Number.isFinite(x.quantity) && Number.isFinite(x.unitPrice)
    );

    if (!DATA.length) throw new Error("CSV se valid sales records nahi mile.");

    setOptions("monthFilter", DATA.map(x => x.date.slice(0, 7)));
    setOptions("countryFilter", DATA.map(x => x.country));
    setOptions("productFilter", DATA.map(x => x.product));

    ["monthFilter", "countryFilter", "productFilter"].forEach(id =>
      $(id).addEventListener("change", render)
    );
    $("searchFilter").addEventListener("input", render);

    $("resetBtn").addEventListener("click", () => {
      ["monthFilter", "countryFilter", "productFilter"].forEach(id => {
        $(id).value = "all";
      });
      $("searchFilter").value = "";
      render();
    });

    $("exportBtn").addEventListener("click", () => {
      const rows = filtered();
      const keys = ["date", "country", "product", "customer",
        "invoice", "quantity", "unitPrice", "revenue"];
      const csv = [
        keys.join(","),
        ...rows.map(r => keys.map(k =>
          JSON.stringify(r[k] ?? "")
        ).join(","))
      ].join("\n");

      const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8;" })
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "ecommerce-filtered-sales.csv";
      a.click();
      URL.revokeObjectURL(url);
    });

    render();
    console.log("CSV loaded:", DATA.length, "sales records");
  } catch (error) {
    console.error(error);
    alert("Data load nahi hua: " + error.message +
      "\n\nVS Code Live Server se dashboard open karo.");
  }
}

loadData();