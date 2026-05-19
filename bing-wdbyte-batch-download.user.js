// ==UserScript==
// @name         Bing WDByte 4K Batch Downloader
// @namespace    https://bing.wdbyte.com/
// @version      1.0.1
// @description  Add multi-select checkboxes to bing.wdbyte.com thumbnails and batch download selected UHD images into a chosen local folder.
// @author       Codex
// @match        https://bing.wdbyte.com/zh-cn
// @match        https://bing.wdbyte.com/zh-cn/
// @match        https://bing.wdbyte.com/zh-cn/*.html
// @match        https://bing.wdbyte.com/zh-cn/day/*.html
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      cn.bing.com
// ==/UserScript==

(function () {
    "use strict";

    const SELECTOR_LIST = "#img_list";
    const SELECTOR_CARD = ".w3-third";
    const STORAGE_KEY = "bwd-batch-panel-position";
    const selectedItems = new Map();

    let panel;
    let panelButton;
    let panelCount;
    let panelStatus;
    let isDownloading = false;
    let dragState = null;
    let lastDragEndAt = 0;

    injectStyle();
    createPanel();
    initCards();
    observeList();

    function initCards() {
        document.querySelectorAll(`${SELECTOR_LIST} ${SELECTOR_CARD}`).forEach(injectCheckbox);
        updatePanel();
    }

    function observeList() {
        const list = document.querySelector(SELECTOR_LIST);
        if (!list) return;

        const observer = new MutationObserver(() => initCards());
        observer.observe(list, { childList: true, subtree: true });
    }

    function injectCheckbox(card) {
        if (card.querySelector(":scope > .bwd-select-wrap")) return;

        const item = getCardItem(card);
        if (!item) return;

        if (getComputedStyle(card).position === "static") {
            card.style.position = "relative";
        }

        const label = document.createElement("label");
        label.className = "bwd-select-wrap";
        label.title = "选择这张 4K 图片";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "bwd-select";
        checkbox.checked = selectedItems.has(item.url);
        card.classList.toggle("bwd-selected-card", checkbox.checked);

        checkbox.addEventListener("click", (event) => {
            event.stopPropagation();
        });

        checkbox.addEventListener("change", () => {
            const latestItem = getCardItem(card);
            if (!latestItem) return;

            if (checkbox.checked) {
                selectedItems.set(latestItem.url, latestItem);
                card.classList.add("bwd-selected-card");
            } else {
                selectedItems.delete(latestItem.url);
                card.classList.remove("bwd-selected-card");
            }

            updatePanel();
        });

        label.appendChild(checkbox);
        card.appendChild(label);
    }

    function getCardItem(card) {
        const link = Array.from(card.querySelectorAll("a[href]")).find((anchor) => {
            const text = anchor.textContent.trim().toLowerCase();
            const href = anchor.href || "";
            return (text.includes("download 4k") || href.includes("w=3840")) && href.includes("OHR.");
        });

        if (!link) return null;

        let fileName = "";
        try {
            fileName = extractFileName(link.href);
        } catch (_) {
            fileName = "";
        }

        return {
            url: link.href,
            fileName,
            date: getCardDate(card),
        };
    }

    function getCardDate(card) {
        const text = card.querySelector("p")?.textContent || "";
        return text.match(/\d{4}-\d{2}-\d{2}/)?.[0] || "";
    }

    function extractFileName(url) {
        const parsed = new URL(url, location.href);
        const id = parsed.searchParams.get("id");
        const raw = id || decodeURIComponent(url).match(/OHR\.([^&#?]+)/)?.[1];

        if (!raw) {
            throw new Error("未找到 OHR 图片名称");
        }

        const name = raw.replace(/^OHR\./i, "");
        if (!name) {
            throw new Error("图片名称为空");
        }

        return sanitizeFileName(name);
    }

    function sanitizeFileName(fileName) {
        return fileName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+$/g, "");
    }

    function createPanel() {
        panel = document.createElement("div");
        panel.id = "bwd-batch-panel";
        panel.setAttribute("aria-hidden", "true");

        panelButton = document.createElement("button");
        panelButton.id = "bwd-batch-button";
        panelButton.type = "button";

        panelCount = document.createElement("span");
        panelCount.className = "bwd-batch-count";
        panelCount.textContent = "批量下载 (0)";

        panelStatus = document.createElement("span");
        panelStatus.className = "bwd-batch-status";

        panelButton.append(panelCount, panelStatus);
        panel.appendChild(panelButton);
        document.body.appendChild(panel);

        restorePanelPosition();
        bindPanelDrag();

        panelButton.addEventListener("click", async () => {
            if (dragState?.moved || isDownloading) return;
            await startBatchDownload();
        });

        window.addEventListener("resize", clampPanelToViewport);
    }

    function updatePanel(statusText = "") {
        const count = selectedItems.size;
        const visible = count > 0 || isDownloading;
        panelCount.textContent = isDownloading ? "正在下载" : `批量下载 (${count})`;
        panelStatus.textContent = statusText;
        panel.classList.toggle("bwd-visible", visible);
        panel.setAttribute("aria-hidden", visible ? "false" : "true");
        if (visible) window.requestAnimationFrame(clampPanelToViewport);
    }

    async function startBatchDownload() {
        const items = Array.from(selectedItems.values());
        if (!items.length) return;

        const showDirectoryPicker = getShowDirectoryPicker();
        if (!showDirectoryPicker) {
            showResultDialog({
                directoryName: "未选择",
                total: items.length,
                downloaded: 0,
                skipped: 0,
                failed: items.map((item) => ({
                    url: item.url,
                    reason: "当前浏览器不支持选择保存目录；请使用新版 Chrome 或 Edge。",
                })),
            });
            return;
        }

        let directoryHandle;
        try {
            directoryHandle = await showDirectoryPicker({ mode: "readwrite" });
        } catch (error) {
            if (error?.name !== "AbortError") {
                showResultDialog({
                    directoryName: "未选择",
                    total: items.length,
                    downloaded: 0,
                    skipped: 0,
                    failed: items.map((item) => ({
                        url: item.url,
                        reason: `选择目录失败：${toErrorMessage(error)}`,
                    })),
                });
            }
            return;
        }

        const hasPermission = await ensureWritePermission(directoryHandle);
        if (!hasPermission) {
            showResultDialog({
                directoryName: directoryHandle.name || "未知目录",
                total: items.length,
                downloaded: 0,
                skipped: 0,
                failed: items.map((item) => ({
                    url: item.url,
                    reason: "没有目录写入权限",
                })),
            });
            return;
        }

        isDownloading = true;
        panelButton.disabled = true;
        panel.classList.add("bwd-downloading");

        const result = {
            directoryName: directoryHandle.name || "未知目录",
            total: items.length,
            downloaded: 0,
            skipped: 0,
            failed: [],
        };

        for (let index = 0; index < items.length; index += 1) {
            const item = items[index];
            updatePanel(`${index + 1}/${items.length}`);

            try {
                const fileName = item.fileName || extractFileName(item.url);
                const exists = await fileExists(directoryHandle, fileName);
                if (exists) {
                    result.skipped += 1;
                    continue;
                }

                const blob = await downloadBlob(item.url);
                if (!blob || blob.size === 0) {
                    throw new Error("下载内容为空");
                }

                await writeBlob(directoryHandle, fileName, blob);
                result.downloaded += 1;
            } catch (error) {
                result.failed.push({
                    url: item.url,
                    reason: toErrorMessage(error),
                });
            }
        }

        isDownloading = false;
        panelButton.disabled = false;
        panel.classList.remove("bwd-downloading");
        updatePanel("");
        showResultDialog(result);
    }

    function getShowDirectoryPicker() {
        if (typeof window.showDirectoryPicker === "function") {
            return window.showDirectoryPicker.bind(window);
        }

        if (typeof unsafeWindow !== "undefined" && typeof unsafeWindow.showDirectoryPicker === "function") {
            return unsafeWindow.showDirectoryPicker.bind(unsafeWindow);
        }

        return null;
    }

    async function ensureWritePermission(directoryHandle) {
        const options = { mode: "readwrite" };

        if (typeof directoryHandle.queryPermission === "function") {
            const current = await directoryHandle.queryPermission(options);
            if (current === "granted") return true;
        }

        if (typeof directoryHandle.requestPermission === "function") {
            const requested = await directoryHandle.requestPermission(options);
            return requested === "granted";
        }

        return true;
    }

    async function fileExists(directoryHandle, fileName) {
        try {
            await directoryHandle.getFileHandle(fileName, { create: false });
            return true;
        } catch (error) {
            if (error?.name === "NotFoundError") return false;
            throw error;
        }
    }

    function downloadBlob(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url,
                responseType: "blob",
                timeout: 90000,
                onload(response) {
                    if (response.status >= 200 && response.status < 300 && response.response) {
                        resolve(response.response);
                        return;
                    }

                    reject(new Error(`HTTP ${response.status || "未知状态"}`));
                },
                ontimeout() {
                    reject(new Error("下载超时"));
                },
                onerror(error) {
                    reject(new Error(toErrorMessage(error) || "网络错误"));
                },
                onabort() {
                    reject(new Error("下载被中止"));
                },
            });
        });
    }

    async function writeBlob(directoryHandle, fileName, blob) {
        const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();

        try {
            await writable.write(blob);
            await writable.close();
        } catch (error) {
            try {
                await writable.abort();
            } catch (_) {
                // Ignore abort failures and surface the original write error.
            }
            throw error;
        }
    }

    function showResultDialog(result) {
        document.querySelector("#bwd-result-mask")?.remove();

        const failedUrls = result.failed.map((item) => item.url).join("\n");
        const mask = document.createElement("div");
        mask.id = "bwd-result-mask";

        const dialog = document.createElement("div");
        dialog.id = "bwd-result-dialog";
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");

        const title = document.createElement("h2");
        title.textContent = "批量下载完成";

        const summary = document.createElement("div");
        summary.className = "bwd-result-summary";
        summary.append(
            createSummaryRow("下载目录", `${result.directoryName}（浏览器仅暴露目录名）`),
            createSummaryRow("选中数量", String(result.total)),
            createSummaryRow("成功下载", String(result.downloaded)),
            createSummaryRow("重名跳过", String(result.skipped)),
            createSummaryRow("失败数量", String(result.failed.length)),
        );

        dialog.append(title, summary);

        if (result.failed.length) {
            const label = document.createElement("label");
            label.className = "bwd-failed-label";
            label.textContent = "失败 URL";

            const textarea = document.createElement("textarea");
            textarea.readOnly = true;
            textarea.value = failedUrls;

            const details = document.createElement("details");
            details.className = "bwd-failed-details";
            const detailsTitle = document.createElement("summary");
            detailsTitle.textContent = "失败原因";
            const reasonList = document.createElement("ol");
            result.failed.forEach((item) => {
                const li = document.createElement("li");
                li.textContent = `${item.reason} - ${item.url}`;
                reasonList.appendChild(li);
            });
            details.append(detailsTitle, reasonList);

            const copyButton = document.createElement("button");
            copyButton.type = "button";
            copyButton.className = "bwd-secondary-button";
            copyButton.textContent = "复制失败 URL";
            copyButton.addEventListener("click", async () => {
                try {
                    await navigator.clipboard.writeText(failedUrls);
                } catch (_) {
                    textarea.focus();
                    textarea.select();
                    document.execCommand("copy");
                }
                copyButton.textContent = "已复制";
                setTimeout(() => {
                    copyButton.textContent = "复制失败 URL";
                }, 1500);
            });

            dialog.append(label, textarea, details, copyButton);
        }

        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.className = "bwd-primary-button";
        closeButton.textContent = "关闭";
        closeButton.addEventListener("click", () => mask.remove());

        dialog.appendChild(closeButton);
        mask.appendChild(dialog);
        document.body.appendChild(mask);
    }

    function createSummaryRow(label, value) {
        const row = document.createElement("p");
        const labelElement = document.createElement("strong");
        labelElement.textContent = `${label}：`;
        const valueElement = document.createElement("span");
        valueElement.textContent = value;
        row.append(labelElement, valueElement);
        return row;
    }

    function bindPanelDrag() {
        panel.addEventListener("pointerdown", (event) => {
            if (event.button !== 0 || isDownloading) return;

            const rect = panel.getBoundingClientRect();
            dragState = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                offsetX: event.clientX - rect.left,
                offsetY: event.clientY - rect.top,
                moved: false,
            };

            document.addEventListener("pointermove", handlePanelPointerMove, true);
            document.addEventListener("pointerup", handlePanelPointerUp, true);
            document.addEventListener("pointercancel", handlePanelPointerCancel, true);
        });

        panel.addEventListener("click", (event) => {
            if (Date.now() - lastDragEndAt < 180) {
                event.preventDefault();
                event.stopPropagation();
            }
        }, true);
    }

    function handlePanelPointerMove(event) {
        if (!dragState || dragState.pointerId !== event.pointerId) return;

        const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY);
        if (!dragState.moved && distance < 4) return;

        dragState.moved = true;
        event.preventDefault();

        const rect = panel.getBoundingClientRect();
        const x = clamp(event.clientX - dragState.offsetX, 8, window.innerWidth - rect.width - 8);
        const y = clamp(event.clientY - dragState.offsetY, 8, window.innerHeight - rect.height - 8);

        panel.style.left = `${x}px`;
        panel.style.top = `${y}px`;
        panel.style.right = "auto";
        panel.style.bottom = "auto";
    }

    function handlePanelPointerUp(event) {
        if (!dragState || dragState.pointerId !== event.pointerId) return;

        const moved = dragState.moved;
        cleanupPanelDrag();

        if (moved) {
            event.preventDefault();
            event.stopPropagation();
            lastDragEndAt = Date.now();
            savePanelPosition();
        }
    }

    function handlePanelPointerCancel() {
        if (dragState?.moved) {
            lastDragEndAt = Date.now();
            savePanelPosition();
        }
        cleanupPanelDrag();
    }

    function cleanupPanelDrag() {
        document.removeEventListener("pointermove", handlePanelPointerMove, true);
        document.removeEventListener("pointerup", handlePanelPointerUp, true);
        document.removeEventListener("pointercancel", handlePanelPointerCancel, true);
        dragState = null;
    }

    function restorePanelPosition() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
            if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return;

            panel.style.left = `${saved.x}px`;
            panel.style.top = `${saved.y}px`;
            panel.style.right = "auto";
            panel.style.bottom = "auto";
            clampPanelToViewport();
        } catch (_) {
            localStorage.removeItem(STORAGE_KEY);
        }
    }

    function savePanelPosition() {
        const rect = panel.getBoundingClientRect();
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: rect.left, y: rect.top }));
    }

    function clampPanelToViewport() {
        const rect = panel.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        const x = clamp(rect.left, 8, window.innerWidth - rect.width - 8);
        const y = clamp(rect.top, 8, window.innerHeight - rect.height - 8);
        panel.style.left = `${x}px`;
        panel.style.top = `${y}px`;
        panel.style.right = "auto";
        panel.style.bottom = "auto";
        savePanelPosition();
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), Math.max(min, max));
    }

    function toErrorMessage(error) {
        if (!error) return "";
        if (typeof error === "string") return error;
        if (error.message) return error.message;
        try {
            return JSON.stringify(error);
        } catch (_) {
            return String(error);
        }
    }

    function injectStyle() {
        const style = document.createElement("style");
        style.textContent = `
            #img_list ${SELECTOR_CARD}.bwd-selected-card .bigImg {
                outline: 3px solid #22c55e;
                outline-offset: -3px;
                border-radius: 8px;
            }

            .bwd-select-wrap {
                align-items: center;
                background: rgba(17, 24, 39, 0.78);
                border: 1px solid rgba(255, 255, 255, 0.72);
                border-radius: 8px;
                bottom: 52px;
                box-shadow: 0 6px 16px rgba(0, 0, 0, 0.22);
                cursor: pointer;
                display: flex;
                height: 30px;
                justify-content: center;
                position: absolute;
                right: 22px;
                width: 30px;
                z-index: 20;
            }

            .bwd-select-wrap:hover {
                background: rgba(22, 163, 74, 0.9);
            }

            .bwd-select {
                accent-color: #16a34a;
                cursor: pointer;
                height: 18px;
                margin: 0;
                width: 18px;
            }

            #bwd-batch-panel {
                position: fixed;
                right: 24px;
                top: 45vh;
                z-index: 2147483646;
                display: none;
                touch-action: none;
                user-select: none;
            }

            #bwd-batch-panel.bwd-visible {
                display: block;
            }

            #bwd-batch-button {
                align-items: center;
                background: #111827;
                border: 1px solid rgba(255, 255, 255, 0.2);
                border-radius: 8px;
                box-shadow: 0 12px 30px rgba(0, 0, 0, 0.28);
                color: #fff;
                cursor: grab;
                display: flex;
                flex-direction: column;
                font-size: 14px;
                font-weight: 700;
                gap: 4px;
                min-width: 128px;
                padding: 11px 14px;
            }

            #bwd-batch-button:hover {
                background: #166534;
            }

            #bwd-batch-button:disabled {
                cursor: wait;
                opacity: 0.78;
            }

            .bwd-batch-status {
                color: #d1fae5;
                font-size: 12px;
                font-weight: 500;
                min-height: 14px;
            }

            #bwd-result-mask {
                align-items: center;
                background: rgba(15, 23, 42, 0.55);
                display: flex;
                inset: 0;
                justify-content: center;
                padding: 18px;
                position: fixed;
                z-index: 2147483647;
            }

            #bwd-result-dialog {
                background: #fff;
                border-radius: 8px;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
                color: #111827;
                max-height: min(760px, 92vh);
                max-width: min(620px, 94vw);
                overflow: auto;
                padding: 20px;
                width: 100%;
            }

            #bwd-result-dialog h2 {
                font-size: 20px;
                line-height: 1.3;
                margin: 0 0 14px;
            }

            .bwd-result-summary {
                display: grid;
                gap: 8px;
                margin-bottom: 14px;
            }

            .bwd-result-summary p {
                display: flex;
                gap: 8px;
                justify-content: space-between;
                line-height: 1.45;
                margin: 0;
            }

            .bwd-result-summary span {
                min-width: 0;
                overflow-wrap: anywhere;
                text-align: right;
            }

            .bwd-failed-label {
                display: block;
                font-weight: 700;
                margin: 12px 0 6px;
            }

            #bwd-result-dialog textarea {
                border: 1px solid #cbd5e1;
                border-radius: 8px;
                box-sizing: border-box;
                display: block;
                font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
                font-size: 12px;
                min-height: 120px;
                padding: 10px;
                resize: vertical;
                width: 100%;
            }

            .bwd-failed-details {
                margin: 10px 0;
            }

            .bwd-failed-details ol {
                margin: 8px 0 0;
                padding-left: 22px;
            }

            .bwd-failed-details li {
                overflow-wrap: anywhere;
                padding: 3px 0;
            }

            .bwd-primary-button,
            .bwd-secondary-button {
                border: 0;
                border-radius: 8px;
                cursor: pointer;
                font-size: 14px;
                font-weight: 700;
                margin-top: 12px;
                padding: 9px 14px;
            }

            .bwd-primary-button {
                background: #111827;
                color: #fff;
                float: right;
            }

            .bwd-secondary-button {
                background: #dcfce7;
                color: #14532d;
                margin-right: 10px;
            }

            @media (max-width: 680px) {
                .bwd-select-wrap {
                    bottom: 48px;
                    right: 18px;
                }

                #bwd-batch-button {
                    min-width: 112px;
                    padding: 10px 12px;
                }
            }
        `;
        document.documentElement.appendChild(style);
    }
})();
