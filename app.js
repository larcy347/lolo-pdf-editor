import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";
const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
const $ = (s) => document.querySelector(s);
const state = { pdf: null, sourceBytes: null, fileName: "edited-document.pdf", page: 1, scale: 1, tool: "select", order: [], annotations: new Map(), drawing: null, pendingPoint: null, dirty: false };
const els = {
  file: $("#file-input"), image: $("#image-input"), save: $("#save-button"), welcome: $("#welcome"), stage: $("#document-stage"),
  pdfCanvas: $("#pdf-canvas"), annotationCanvas: $("#annotation-canvas"), textLayer: $("#text-layer"), thumbnails: $("#thumbnails"),
  count: $("#page-count"), total: $("#current-page-total"), pageInput: $("#page-input"), previous: $("#previous-page"), next: $("#next-page"),
  zoomIn: $("#zoom-in"), zoomOut: $("#zoom-out"), zoomLabel: $("#zoom-label"), color: $("#color-input"), size: $("#size-input"),
  undo: $("#undo-button"), clear: $("#clear-button"), status: $("#status"), dialog: $("#text-dialog"), textForm: $("#text-form"), textValue: $("#text-value"),
  pages: $("#pages-dialog"), manager: $("#page-manager"), editPages: $("#edit-pages")
};
function setStatus(message) { els.status.textContent = message; }
function currentOriginalPage() { return state.order[state.page - 1]; }
function pageAnnotations(original = currentOriginalPage()) { if (!state.annotations.has(original)) state.annotations.set(original, []); return state.annotations.get(original); }
function markDirty() { state.dirty = true; els.save.disabled = !state.pdf; clearTimeout(state.saveTimer); state.saveTimer = setTimeout(saveProject, 900); }
function setEnabled(enabled) { [els.save, els.pageInput, els.previous, els.next, els.zoomIn, els.zoomOut, els.editPages].forEach((e) => { e.disabled = !enabled; }); }
function canvasPoint(event) { const r = els.annotationCanvas.getBoundingClientRect(); return { x: (event.clientX - r.left) / r.width * els.annotationCanvas.width, y: (event.clientY - r.top) / r.height * els.annotationCanvas.height }; }

async function openPdf(file) {
  try {
    setStatus("Loading PDF...");
    state.sourceBytes = new Uint8Array(await file.arrayBuffer()); state.fileName = file.name.replace(/\.pdf$/i, "") + "-edited.pdf";
    state.pdf = await pdfjsLib.getDocument({ data: state.sourceBytes.slice() }).promise;
    state.page = 1; state.scale = 1; state.order = Array.from({ length: state.pdf.numPages }, (_, i) => i + 1); state.annotations.clear(); state.dirty = false;
    els.welcome.hidden = true; els.stage.hidden = false; setEnabled(true); els.count.textContent = state.order.length; els.total.textContent = state.order.length; els.pageInput.max = state.order.length;
    await renderPage(); setStatus(`${file.name} loaded`); renderThumbnails();
  } catch (error) { console.error(error); setStatus("Could not open this PDF. Please choose a valid, non-password-protected file."); }
}
async function renderThumbnails() {
  els.thumbnails.replaceChildren();
  const memory = navigator.deviceMemory || 4;
  const limit = memory <= 2 ? 30 : 80;
  if (state.order.length > limit) setStatus(`PDF loaded; thumbnails limited to ${limit} pages to protect memory.`);
  for (let index = 0; index < Math.min(state.order.length, limit); index += 1) {
    const number = state.order[index], wrapper = document.createElement("div"); wrapper.className = "thumbnail"; wrapper.dataset.page = index + 1;
    const canvas = document.createElement("canvas"), page = await state.pdf.getPage(number), viewport = page.getViewport({ scale: .18 });
    canvas.width = viewport.width; canvas.height = viewport.height; await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    const label = document.createElement("span"); label.className = "thumbnail-number"; label.textContent = index + 1;
    wrapper.append(canvas, label); wrapper.addEventListener("click", () => { state.page = index + 1; renderPage(); }); els.thumbnails.append(wrapper);
  }
}
async function renderPage() {
  if (!state.pdf || !state.order.length) return;
  const page = await state.pdf.getPage(currentOriginalPage()), viewport = page.getViewport({ scale: state.scale });
  els.pdfCanvas.width = viewport.width; els.pdfCanvas.height = viewport.height; els.annotationCanvas.width = viewport.width; els.annotationCanvas.height = viewport.height;
  els.stage.style.width = `${viewport.width}px`; els.stage.style.height = `${viewport.height}px`;
  await page.render({ canvasContext: els.pdfCanvas.getContext("2d"), viewport }).promise; drawAnnotations(); renderTextAnnotations();
  els.pageInput.value = state.page; els.zoomLabel.textContent = `${Math.round(state.scale * 100)}%`; els.previous.disabled = state.page === 1; els.next.disabled = state.page === state.order.length;
  els.undo.disabled = pageAnnotations().length === 0; els.clear.disabled = pageAnnotations().length === 0;
  document.querySelectorAll(".thumbnail").forEach((n) => n.classList.toggle("active", Number(n.dataset.page) === state.page));
}
function drawAnnotations() {
  const c = els.annotationCanvas.getContext("2d"); c.clearRect(0, 0, els.annotationCanvas.width, els.annotationCanvas.height);
  pageAnnotations().forEach((a) => {
    if (a.type === "draw") { c.strokeStyle = a.color; c.lineWidth = a.size; c.lineCap = "round"; c.beginPath(); a.points.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.stroke(); }
    if (a.type === "highlight") { c.fillStyle = `${a.color}66`; c.fillRect(a.x, a.y, a.width, a.height); }
    if (a.type === "image" && a.element) c.drawImage(a.element, a.x, a.y, a.width, a.height);
  });
}
function renderTextAnnotations() {
  els.textLayer.replaceChildren();
  pageAnnotations().forEach((a) => {
    if (!["text", "signature", "field", "checkbox"].includes(a.type)) return;
    const node = a.type === "checkbox" ? document.createElement("input") : a.type === "field" ? document.createElement("input") : document.createElement("div");
    node.className = a.type === "signature" ? "placed-text placed-signature" : a.type === "field" ? "placed-field" : a.type === "checkbox" ? "placed-check" : "placed-text";
    if (a.type === "checkbox") { node.type = "checkbox"; node.checked = !!a.checked; node.addEventListener("change", () => { a.checked = node.checked; markDirty(); }); }
    else if (a.type === "field") { node.type = "text"; node.placeholder = a.label; node.value = a.value || ""; node.addEventListener("input", () => { a.value = node.value; markDirty(); }); }
    else node.textContent = a.value;
    Object.assign(node.style, { left: `${a.x}px`, top: `${a.y}px`, color: a.color || "#172033", fontSize: `${a.size || 18}px` });
    if (a.type === "field") { node.style.width = `${a.width}px`; node.style.height = `${a.height}px`; }
    if (a.type === "checkbox") node.style.width = node.style.height = `${a.size || 22}px`;
    node.title = "Double-click to edit; drag to move";
    node.addEventListener("dblclick", () => { if (a.type === "text" || a.type === "signature") { const value = prompt("Edit text", a.value); if (value !== null) { a.value = value; markDirty(); renderPage(); } } });
    node.addEventListener("pointerdown", (event) => { if (state.tool !== "select") return; const start = { x: event.clientX, y: event.clientY, left: a.x, top: a.y }; const move = (e) => { a.x = start.left + e.clientX - start.x; a.y = start.top + e.clientY - start.y; node.style.left = `${a.x}px`; node.style.top = `${a.y}px`; }; const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); markDirty(); }; window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop); });
    els.textLayer.append(node);
  });
}
function addTextAt(point) { state.pendingPoint = point; els.dialog.hidden = false; els.textValue.value = ""; els.textValue.focus(); }
function addImageAt(point) { state.pendingPoint = point; els.image.click(); }
function addImage(file) { const image = new Image(), objectUrl = URL.createObjectURL(file); image.onload = () => { URL.revokeObjectURL(objectUrl); const max = Math.min(220, els.annotationCanvas.width * .35), ratio = image.width / image.height; pageAnnotations().push({ type: "image", element: image, source: file, x: state.pendingPoint.x, y: state.pendingPoint.y, width: max, height: max / ratio }); markDirty(); renderPage(); }; image.src = objectUrl; }
function addSpecial(point) {
  if (state.tool === "signature") { const value = prompt("Signature name or initials:"); if (value) pageAnnotations().push({ type: "signature", value, x: point.x, y: point.y, color: els.color.value, size: Number(els.size.value) }); }
  if (state.tool === "field") { const label = prompt("Field label:", "Type here"); if (label) pageAnnotations().push({ type: "field", label, x: point.x, y: point.y, width: 180, height: 30, color: els.color.value }); }
  if (state.tool === "checkbox") pageAnnotations().push({ type: "checkbox", x: point.x, y: point.y, size: 22, checked: false });
  markDirty(); renderPage();
}
function renderPageManager() {
  els.manager.replaceChildren(); state.order.forEach((original, index) => { const row = document.createElement("div"); row.className = "page-manager-row"; const label = document.createElement("span"); label.textContent = `Page ${index + 1}`; const up = document.createElement("button"); up.textContent = "↑"; up.disabled = index === 0; const down = document.createElement("button"); down.textContent = "↓"; down.disabled = index === state.order.length - 1; const del = document.createElement("button"); del.textContent = "Delete"; up.onclick = () => movePage(index, -1); down.onclick = () => movePage(index, 1); del.onclick = () => deletePage(index); row.append(label, up, down, del); els.manager.append(row); }); }
function movePage(index, delta) { const target = index + delta; if (target < 0 || target >= state.order.length) return; [state.order[index], state.order[target]] = [state.order[target], state.order[index]]; state.page = target + 1; markDirty(); renderPageManager(); renderThumbnails(); renderPage(); }
function deletePage(index) { if (state.order.length === 1) return setStatus("A PDF must contain at least one page."); state.order.splice(index, 1); state.page = Math.min(state.page, state.order.length); markDirty(); els.count.textContent = state.order.length; els.total.textContent = state.order.length; els.pageInput.max = state.order.length; renderPageManager(); renderThumbnails(); renderPage(); }
async function saveProject() {
  if (!state.pdf || !state.dirty) return;
  try { const annotations = {}; state.annotations.forEach((items, key) => { annotations[key] = items.map(({ element, source, ...a }) => a); }); localStorage.setItem("lolo-pdf-project", JSON.stringify({ source: Array.from(state.sourceBytes), order: state.order, annotations, fileName: state.fileName })); setStatus("Project autosaved"); }
  catch (e) { setStatus("Autosave skipped (storage limit reached). Export still works."); }
}
async function exportPdf() {
  try {
    els.save.disabled = true; setStatus("Exporting edited PDF...");
    const source = await PDFDocument.load(state.sourceBytes), output = await PDFDocument.create(), font = await output.embedFont(StandardFonts.Helvetica);
    const copied = await output.copyPages(source, state.order.map((n) => n - 1)); copied.forEach((p) => output.addPage(p));
    for (const [original, annotations] of state.annotations) { const orderIndex = state.order.indexOf(Number(original)); if (orderIndex < 0) continue; const page = output.getPage(orderIndex), viewport = (await state.pdf.getPage(Number(original))).getViewport({ scale: 1 }), factor = page.getWidth() / viewport.width, ph = viewport.height * factor; for (const a of annotations) {
      const x = a.x * factor, y = ph - (a.y + (a.size || a.height || 0)) * factor;
      if (["text", "signature"].includes(a.type)) page.drawText(a.value, { x, y, size: (a.size || 18) * factor, font, color: rgb(...hexRgb(a.color || "#172033")) });
      if (a.type === "field") { page.drawRectangle({ x, y, width: a.width * factor, height: a.height * factor, borderColor: rgb(...hexRgb("#2563eb")), borderWidth: 1 }); if (a.value) page.drawText(a.value, { x: x + 3, y: y + 8, size: 12 * factor, font }); }
      if (a.type === "checkbox") { page.drawRectangle({ x, y, width: 18 * factor, height: 18 * factor, borderColor: rgb(...hexRgb("#172033")), borderWidth: 1 }); if (a.checked) page.drawText("✓", { x: x + 2, y: y + 1, size: 15 * factor, font }); }
      if (a.type === "highlight") page.drawRectangle({ x, y, width: a.width * factor, height: a.height * factor, color: rgb(...hexRgb(a.color)), opacity: .35, borderOpacity: 0 });
      if (a.type === "draw" && a.points.length > 1) for (let i = 1; i < a.points.length; i += 1) page.drawLine({ start: { x: a.points[i - 1].x * factor, y: ph - a.points[i - 1].y * factor }, end: { x: a.points[i].x * factor, y: ph - a.points[i].y * factor }, thickness: a.size * factor, color: rgb(...hexRgb(a.color)) });
      if (a.type === "image" && a.source) { const bytes = new Uint8Array(await a.source.arrayBuffer()), embedded = a.source.type.includes("png") ? await output.embedPng(bytes) : await output.embedJpg(bytes); page.drawImage(embedded, { x, y, width: a.width * factor, height: a.height * factor }); }
    } }
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([await output.save()], { type: "application/pdf" })); link.download = state.fileName; link.click(); setStatus("PDF exported successfully"); state.dirty = false;
  } catch (error) { console.error(error); setStatus("Export failed. Please try again."); } finally { els.save.disabled = false; }
}
function hexRgb(hex) { const v = hex.replace("#", ""); return [parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255]; }

els.file.addEventListener("change", () => { if (els.file.files[0]) openPdf(els.file.files[0]); });
els.image.addEventListener("change", () => { if (els.image.files[0]) addImage(els.image.files[0]); els.image.value = ""; });
document.querySelectorAll("[data-tool]").forEach((b) => b.addEventListener("click", () => { state.tool = b.dataset.tool; document.querySelectorAll("[data-tool]").forEach((x) => x.classList.toggle("active", x === b)); els.annotationCanvas.style.cursor = state.tool === "select" ? "default" : "crosshair"; }));
els.annotationCanvas.addEventListener("pointerdown", (e) => { if (!state.pdf || state.tool === "select") return; const p = canvasPoint(e); if (state.tool === "text") return addTextAt(p); if (state.tool === "image") return addImageAt(p); if (["signature", "field", "checkbox"].includes(state.tool)) return addSpecial(p); state.drawing = { start: p, points: [p] }; els.annotationCanvas.setPointerCapture(e.pointerId); });
els.annotationCanvas.addEventListener("pointermove", (e) => { if (!state.drawing) return; const p = canvasPoint(e); if (state.tool === "draw") state.drawing.points.push(p); drawAnnotations(); const c = els.annotationCanvas.getContext("2d"); c.strokeStyle = els.color.value; c.lineWidth = Number(els.size.value); c.lineCap = "round"; if (state.tool === "draw") { c.beginPath(); state.drawing.points.forEach((x, i) => i ? c.lineTo(x.x, x.y) : c.moveTo(x.x, x.y)); c.stroke(); } else { c.fillStyle = `${els.color.value}66`; c.fillRect(state.drawing.start.x, state.drawing.start.y, p.x - state.drawing.start.x, p.y - state.drawing.start.y); } });
els.annotationCanvas.addEventListener("pointerup", (e) => { if (!state.drawing) return; const p = canvasPoint(e); pageAnnotations().push(state.tool === "draw" ? { type: "draw", points: state.drawing.points, color: els.color.value, size: Number(els.size.value) } : { type: "highlight", x: state.drawing.start.x, y: state.drawing.start.y, width: p.x - state.drawing.start.x, height: p.y - state.drawing.start.y, color: els.color.value }); state.drawing = null; markDirty(); renderPage(); });
els.textForm.addEventListener("submit", (e) => { e.preventDefault(); const value = els.textValue.value.trim(); if (value) pageAnnotations().push({ type: "text", value, x: state.pendingPoint.x, y: state.pendingPoint.y, color: els.color.value, size: Number(els.size.value) }); els.dialog.hidden = true; markDirty(); renderPage(); });
$("#cancel-text").onclick = () => { els.dialog.hidden = true; }; els.undo.onclick = () => { pageAnnotations().pop(); markDirty(); renderPage(); }; els.clear.onclick = () => { state.annotations.set(currentOriginalPage(), []); markDirty(); renderPage(); };
els.previous.onclick = () => { if (state.page > 1) { state.page -= 1; renderPage(); } }; els.next.onclick = () => { if (state.page < state.order.length) { state.page += 1; renderPage(); } };
els.pageInput.onchange = () => { state.page = Math.max(1, Math.min(state.order.length, Number(els.pageInput.value))); renderPage(); }; els.zoomIn.onclick = () => { state.scale = Math.min(2.5, state.scale + .1); renderPage(); }; els.zoomOut.onclick = () => { state.scale = Math.max(.5, state.scale - .1); renderPage(); };
els.save.onclick = exportPdf; els.editPages.onclick = () => { renderPageManager(); els.pages.hidden = false; }; $("#close-pages").onclick = () => { els.pages.hidden = true; };
window.addEventListener("beforeunload", saveProject);
