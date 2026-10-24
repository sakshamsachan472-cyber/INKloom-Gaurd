const initialDraft = "Our team is thrilled to launch GreenSteps sneakers. Our shoes are completely 100% waterproof and endorsed by NASA! This draft was written by our external marketing group for the Q3 release schedule. If you have questions, please look at the confidential pricing spreadsheet at internal-v2.xlsx.";
const sampleDrafts = {
    web: initialDraft,
    social: "Meet your new everyday favorite: GreenSteps shoes are here! Click here to discover why everyone says they are the best ever. #GreenSteps #NewShoes",
    email: "Subject: A fresh step for your everyday\n\nHello there,\n\nWe are pleased to introduce the new GreenSteps everyday shoe. Explore the thoughtful details and find your next favorite pair.\n\nView product details: greensteps.example/products\n\nThanks,\nThe GreenSteps team",
    product: "GreenSteps Everyday Shoe\n\nA lightweight everyday shoe with a simple, versatile design. Made for daily walks and easy styling, with a cushioned footbed and a flexible outsole. Available in a range of colors.",
    visual: "Visual caption: GreenSteps shoes on a walking trail at sunrise.\n\nAlt text: A pair of green walking shoes beside a trail at sunrise."
}; 

const editor = document.getElementById("editor");
const issueList = document.getElementById("issueList");
const activityList = document.getElementById("activityList");
const roleSelect = document.getElementById("roleSelect");
const workflowActionBtn = document.getElementById("workflowActionBtn");
const scanSummary = document.getElementById("scanSummary");
const workflowStatus = document.getElementById("workflowStatus");

let currentFindings = [];
let resolvedFindings = [];
let scanHasRun = false;
let workflowState = "draft";
let draftBaselineText = getDraftText();
let version = 1;
let appliedCount = 0;
let scanCount = 0;
let issueFrequency = {};
let importedMarkup = "";
let importedAsset = "";
let draftNotice = "";
const reviewHistoryKey = "inkloom.reviewHistory";
const approvalQueueKey = "inkloom.approvalQueue";
const draftStorageKey = "inkloom.creatorDraft";
const managerFilterKey = "inkloom.managerFilter";
const reviewHistoryContainer = document.getElementById("reviewHistory");
const historyNotice = document.getElementById("historyNotice");
const draftSaveStatus = document.getElementById("draftSaveStatus");
let reviewHistory = loadReviewHistory();
let approvalQueue = loadApprovalQueue();
let activeApprovalId = null;
let publishedDraftLocked = false;
let lastLoadedPublishedId = null;
let roleTransitionTimer = null;
let draftSaveTimer = null;
let draftNeedsSave = false;

function setDraftSaveStatus(message, isError = false) {
    draftSaveStatus.textContent = message;
    draftSaveStatus.classList.toggle("is-error", isError);
}

function saveDraftNow() {
    if (publishedDraftLocked) return true;
    const draft = {
        title: document.getElementById("editorTitle").textContent.trim(),
        type: document.getElementById("contentType").value,
        content: getDraftText(),
        baseline: draftBaselineText,
        version,
        updatedAt: new Date().toISOString()
    };
    try {
        localStorage.setItem(draftStorageKey, JSON.stringify(draft));
        setDraftSaveStatus("Saved in this browser");
        draftNeedsSave = false;
        return true;
    } catch (error) {
        console.error("Could not autosave the creator draft.", error);
        setDraftSaveStatus("Could not save · check browser storage", true);
        return false;
    }
}

function scheduleDraftSave() {
    draftNeedsSave = true;
    setDraftSaveStatus("Saving…");
    if (draftSaveTimer) window.clearTimeout(draftSaveTimer);
    draftSaveTimer = window.setTimeout(() => {
        draftSaveTimer = null;
        saveDraftNow();
    }, 350);
}

function restoreSavedDraft() {
    try {
        const saved = localStorage.getItem(draftStorageKey);
        if (!saved) return false;
        const draft = JSON.parse(saved);
        const knownType = [...document.getElementById("contentType").options]
            .some((option) => option.value === draft.type);
        if (
            !draft || typeof draft.title !== "string" ||
            typeof draft.content !== "string" || typeof draft.baseline !== "string" ||
            typeof draft.updatedAt !== "string" || !Number.isFinite(Date.parse(draft.updatedAt)) ||
            (draft.version !== undefined && (!Number.isInteger(draft.version) || draft.version < 1)) ||
            !knownType
        ) throw new Error("Saved creator draft data is invalid.");
        const latestPublished = approvalQueue
            .filter((item) => item.status === "published" && item.title.trim().toLocaleLowerCase() === draft.title.trim().toLocaleLowerCase())
            .sort((left, right) => Date.parse(right.decisionDate || right.date) - Date.parse(left.decisionDate || left.date))[0];
        if (latestPublished && Date.parse(latestPublished.decisionDate || latestPublished.date) > Date.parse(draft.updatedAt)) {
            return false;
        }
        document.getElementById("editorTitle").textContent = draft.title;
        document.getElementById("contentType").value = draft.type;
        editor.textContent = draft.content;
        draftBaselineText = draft.baseline;
        version = draft.version || 1;
        document.getElementById("versionNumber").textContent = String(version);
        publishedDraftLocked = false;
        draftNeedsSave = false;
        const rejection = approvalQueue
            .filter((item) =>
                item.status === "changes_requested" &&
                item.title.trim().toLocaleLowerCase() === draft.title.trim().toLocaleLowerCase()
            )
            .sort((left, right) => Date.parse(right.decisionDate || right.date) - Date.parse(left.decisionDate || left.date))[0];
        if (rejection) {
            draftNotice = `The manager requested changes: ${rejection.rejectionReason || "Review the feedback before resubmitting."}`;
        }
        setDraftSaveStatus(`Restored saved draft · ${new Date(draft.updatedAt).toLocaleString()}`);
        const latestPublishedId = approvalQueue
            .filter((item) => item.status === "published")
            .sort((left, right) => Date.parse(right.decisionDate || right.date) - Date.parse(left.decisionDate || left.date))[0]?.id;
        if (latestPublishedId) lastLoadedPublishedId = latestPublishedId;
        return true;
    } catch (error) {
        console.error("Could not restore the creator draft.", error);
        setDraftSaveStatus("Saved draft could not be restored", true);
        return false;
    }
}

function clearSavedDraft() {
    draftNeedsSave = false;
    if (draftSaveTimer) {
        window.clearTimeout(draftSaveTimer);
        draftSaveTimer = null;
    }
    try {
        localStorage.removeItem(draftStorageKey);
        setDraftSaveStatus("Saved in this browser");
    } catch (error) {
        console.error("Could not clear the submitted creator draft.", error);
        setDraftSaveStatus("Submitted · old draft could not be cleared", true);
    }
}

function transitionToRole(role) {
    const transition = document.getElementById("roleTransition");
    const mark = document.getElementById("roleTransitionMark");
    const title = document.getElementById("roleTransitionTitle");
    const caption = document.getElementById("roleTransitionCaption");
    const isManager = role === "manager";
    const isReviewer = role === "reviewer";
    mark.textContent = isManager ? "JL" : isReviewer ? "TK" : "AM";
    title.textContent = isManager ? "Manager workspace" : isReviewer ? "Reviewer workspace" : "Creator workspace";
    caption.textContent = isManager
        ? "Your approval inbox is ready."
        : isReviewer
            ? "Your review workspace is ready."
            : "Your drafts and reviews are ready.";
    transition.classList.toggle("is-manager", isManager);
    transition.classList.toggle("is-reviewer", isReviewer);
    transition.hidden = false;
    transition.setAttribute("aria-hidden", "false");
    transition.classList.remove("is-visible");
    void transition.offsetWidth;
    transition.classList.add("is-visible");

    if (roleTransitionTimer) window.clearTimeout(roleTransitionTimer);
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 760;
    roleTransitionTimer = window.setTimeout(() => {
        transition.hidden = true;
        transition.setAttribute("aria-hidden", "true");
        transition.classList.remove("is-visible");
        roleTransitionTimer = null;
        updateWorkflow();
        setActiveView(getViewFromHash());
    }, delay);
}

function getDraftText() {
    return editor.innerText || editor.textContent || "";
}

function getSentence(text, match) {
    let start = 0;
    for (let index = 0; index < match.index; index += 1) {
        if (text[index] === "\n" || (/[.!?]/.test(text[index]) && (!text[index + 1] || /\s/.test(text[index + 1])))) start = index + 1;
    }
    const afterMatch = match.index + match[0].length;
    let end = text.length;
    for (let index = afterMatch; index < text.length; index += 1) {
        if (text[index] === "\n") {
            end = index;
            break;
        }
        if (/[.!?]/.test(text[index]) && (!text[index + 1] || /\s/.test(text[index + 1]))) {
            end = index + 1;
            break;
        }
    }
    return text.slice(start, end).trim();
}

function addFinding(findings, text, rule) {
    if (!rule.match) return;
    const excerpt = rule.sentence ? getSentence(text, rule.match) : rule.match[0];
    findings.push({
        id: rule.id,
        category: rule.category,
        severity: rule.severity,
        title: rule.title,
        excerpt,
        explanation: rule.explanation,
        recommendation: rule.recommendation,
        replacement: rule.replacement,
        replaceText: rule.replaceText === undefined ? excerpt : rule.replaceText,
        resolved: false
    });
}

function detectFindings() {
    const text = getDraftText();
    const findings = [];
    const isProductDescription = document.getElementById("contentType").value === "product";
    const normalizedText = text.trim().replace(/\s+/g, " ");
    const normalizedBaseline = draftBaselineText.trim().replace(/\s+/g, " ");
    if (isProductDescription && normalizedText !== sampleDrafts.product.trim().replace(/\s+/g, " ")) {
        addFinding(findings, text, {
            id: "product-copy-changed",
            category: "Approved product copy",
            severity: "high",
            title: "Product description differs from the approved copy",
            match: { 0: text, index: 0 },
            explanation: "This product description must use the provided approved wording. Added or changed claims need brand approval before they can be submitted.",
            recommendation: "Restore the approved product description, or ask a manager to approve the new wording separately.",
            replacement: sampleDrafts.product,
            replaceText: text
        });
    } else if (!isProductDescription && normalizedText !== normalizedBaseline) {
        addFinding(findings, text, {
            id: "custom-copy-change",
            category: "Approved copy",
            severity: "high",
            title: "Added or changed wording needs review",
            match: { 0: text, index: 0 },
            explanation: "This draft differs from its supplied or previously approved starting copy. Added or rewritten wording must be checked before approval.",
            recommendation: "Remove the unapproved edit or restore the starting copy. If the wording is intentional, ask a manager to review it.",
            replacement: draftBaselineText,
            replaceText: text
        });
    }
    const claimMatch = text.match(/\b(?:100\s*%\s*(?:waterproof|guaranteed)|endorsed by NASA|NASA[- ]approved|clinically proven)\b/i);
    addFinding(findings, text, {
        id: "unsupported-claim",
        category: "Claims & messaging",
        severity: "high",
        title: "Promotional claim needs evidence",
        match: claimMatch,
        sentence: true,
        explanation: "Absolute performance statements and named endorsements need approved, current substantiation before they can be published.",
        recommendation: "Keep the launch message, but describe a product benefit that is already approved.",
        replacement: "Our shoes are thoughtfully designed for everyday comfort.",
        replaceText: claimMatch ? getSentence(text, claimMatch) : ""
    });

    const sensitiveMatch = text.match(/\b(?:confidential|internal(?:[-_ ][\w.-]+)?\.(?:xlsx|csv|pdf|docx?)|pricing spreadsheet|internal[-_ ]\w+)\b/i);
    if (sensitiveMatch) {
        const sentence = getSentence(text, sensitiveMatch);
        addFinding(findings, text, {
            id: "confidential-reference",
            category: "Privacy & security",
            severity: "critical",
            title: "Internal material referenced in public copy",
            match: sensitiveMatch,
            sentence: true,
            explanation: "Internal file names and confidential business details should not appear in publishable content.",
            recommendation: "Remove the internal reference. If readers need help, point them to a public contact channel instead.",
            replacement: /if you have questions|for questions/i.test(sentence) ? "If you have questions, please contact our team." : "",
            replaceText: sentence
        });
    }

    const termMatch = text.match(/\bsneakers\b/i);
    addFinding(findings, text, {
        id: "approved-terminology",
        category: "Terminology",
        severity: "medium",
        title: "Use the approved product term",
        match: termMatch,
        explanation: "GreenSteps product copy uses “shoes” as its approved customer-facing term for this product.",
        recommendation: "Use the preferred term while keeping the product meaning unchanged.",
        replacement: termMatch ? termMatch[0].replace(/sneakers/i, "shoes") : "",
        replaceText: termMatch ? termMatch[0] : ""
    });

    const toneMatch = text.match(/\b(?:thrilled|unbelievable|best ever|awesome)\b/i);
    addFinding(findings, text, {
        id: "brand-tone",
        category: "Tone of voice",
        severity: "medium",
        title: "Tone is more exuberant than the brand voice",
        match: toneMatch,
        explanation: "GreenSteps guidance calls for warm, confident language rather than superlatives or exaggerated enthusiasm.",
        recommendation: "Choose a measured phrase that keeps the positive launch intent.",
        replacement: toneMatch ? toneMatch[0].replace(/thrilled/i, "pleased").replace(/unbelievable/i, "notable").replace(/best ever/i, "a favorite").replace(/awesome/i, "thoughtful") : "",
        replaceText: toneMatch ? toneMatch[0] : ""
    });

    const accessibilityMatch = text.match(/\b(?:click here|read more)\b/i);
    const markupImagesWithoutAlt = importedMarkup.match(/<img\b(?![^>]*\balt\s*=)[^>]*>/gi) || [];
    if (accessibilityMatch || markupImagesWithoutAlt.length) {
        const match = accessibilityMatch || { 0: markupImagesWithoutAlt[0], index: 0 };
        addFinding(findings, text, {
            id: "accessibility",
            category: "Accessibility",
            severity: "medium",
            title: accessibilityMatch ? "Link text needs context" : "Image needs alternative text",
            match,
            explanation: accessibilityMatch
                ? "Link labels such as “click here” do not explain the destination to people using assistive technology."
                : "The imported HTML contains an image without an alt attribute, so its meaning may be unavailable to screen-reader users.",
            recommendation: accessibilityMatch
                ? "Replace the generic link label with a short description of the destination."
                : "Add concise, useful alt text to the image, or mark it decorative if it adds no information.",
            replacement: accessibilityMatch ? "view product details" : "",
            replaceText: accessibilityMatch ? accessibilityMatch[0] : null
        });
    }

    const outdatedMatch = text.match(/\b(?:20(?:1\d|2[0-5])|last year's|outdated pricing)\b/i);
    addFinding(findings, text, {
        id: "current-information",
        category: "Messaging accuracy",
        severity: "medium",
        title: "Time-sensitive detail may be outdated",
        match: outdatedMatch,
        explanation: "Dates, prices and launch details can go stale. This pattern is a reminder to check the source, not a claim that it is wrong.",
        recommendation: "Confirm this detail with the current approved product or campaign source before publishing.",
        replacement: "",
        replaceText: null
    });

    const assetMatch = importedAsset && !/(?:approved|greensteps)/i.test(importedAsset)
        ? { 0: importedAsset, index: text.indexOf(importedAsset) }
        : text.match(/\b(?!greensteps-approved|approved-logo)[\w-]+\.(?:png|jpe?g|webp|svg)\b/i);
    addFinding(findings, text, {
        id: "visual-consistency",
        category: "Visual consistency",
        severity: "high",
        title: "Asset is not on the approved list",
        match: assetMatch,
        explanation: "This demo cannot verify image contents. The asset name is not marked as an approved GreenSteps brand asset.",
        recommendation: "Choose an asset from the approved GreenSteps library and confirm its usage rights.",
        replacement: importedAsset ? "[Approved GreenSteps visual asset]" : "",
        replaceText: importedAsset || (assetMatch ? assetMatch[0] : "")
    });

    return findings;
}

function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function createDecorativeIcon(className, text) {
    const icon = createElement("span", className, text);
    icon.setAttribute("aria-hidden", "true");
    return icon;
}

function renderFinding(finding) {
    const card = createElement("article", `issue-card severity-${finding.severity}${finding.resolved ? " resolved" : ""}`);
    const topLine = createElement("div", "issue-topline");
    topLine.append(
        createElement("span", "issue-category", finding.category),
        createElement("span", "severity-label", finding.resolved ? finding.reviewedOnly ? "Reviewed" : "Resolved" : finding.severity)
    );
    card.append(topLine, createElement("h3", "", finding.title));
    if (!finding.resolved && finding.excerpt) card.append(createElement("span", "issue-quote", `“${finding.excerpt}”`));
    card.append(createElement("p", "", finding.explanation));
    if (!finding.resolved) card.append(createElement("p", "issue-recommendation", `Suggestion: ${finding.recommendation}`));

    const actions = createElement("div", "issue-actions");
    if (finding.resolved) {
        actions.append(createElement("span", "resolved-mark", finding.reviewedOnly ? "✓ Human verification recorded" : "✓ Change recorded in activity"));
    } else {
        actions.append(createElement("span", "confidence", "Rule match · human review encouraged"));
        const button = createElement("button", "fix-issue-btn", finding.replaceText === null ? "Mark reviewed" : "Apply suggestion");
        button.type = "button";
        button.dataset.issueId = finding.id;
        button.setAttribute("aria-label", `${finding.replaceText === null ? "Mark reviewed" : "Apply suggestion"}: ${finding.title}`);
        actions.append(button);
    }
    card.append(actions);
    issueList.append(card);
}

function renderFindings() {
    issueList.replaceChildren();
    const visibleFindings = [...currentFindings, ...resolvedFindings.slice().reverse()];
    if (!visibleFindings.length) {
        issueList.append(createElement("div", "empty-findings", scanHasRun ? "No issues found. Keep a human reviewer in the loop for final approval." : "Your findings will appear here after review."));
        return;
    }
    visibleFindings.forEach(renderFinding);
}

function updateInsights() {
    const categories = {};
    reviewHistory.forEach((review) => {
        review.categories.forEach((category) => {
            categories[category] = (categories[category] || 0) + 1;
        });
    });
    const repeat = Object.entries(categories).sort((left, right) => right[1] - left[1])[0];
    document.getElementById("repeatInsight").textContent = repeat && repeat[1] > 1
        ? `${repeat[0]} appeared in ${repeat[1]} reviews`
        : reviewHistory.length ? `${reviewHistory.length} review${reviewHistory.length === 1 ? "" : "s"} saved` : "No repeated issues yet";
    document.getElementById("guidanceInsight").textContent = reviewHistory.some((review) =>
        review.findings.some((finding) => finding.id === "unsupported-claim" || finding.id === "current-information")
    ) ? "Substantiation guidance may need clarity" : "No unclear guidance flagged";
    const totalApplied = reviewHistory.reduce((total, review) => total + review.appliedCount, 0);
    document.getElementById("resolvedInsight").textContent = `${totalApplied} suggestion${totalApplied === 1 ? "" : "s"} applied`;
}

function getReviewKey(review) {
    return review.title.trim().toLocaleLowerCase();
}

function loadReviewHistory() {
    try {
        const savedHistory = localStorage.getItem(reviewHistoryKey);
        if (!savedHistory) return [];
        const parsedHistory = JSON.parse(savedHistory);
        if (!Array.isArray(parsedHistory)) throw new Error("Review history data is not a list.");
        const validReviews = parsedHistory.filter((review) =>
            review && typeof review.id === "string" &&
            typeof review.title === "string" &&
            typeof review.type === "string" &&
            typeof review.date === "string" &&
            Number.isFinite(Date.parse(review.date)) &&
            typeof review.content === "string" &&
            Array.isArray(review.categories) &&
            Array.isArray(review.findings)
        );
        const latestReviews = new Map();
        validReviews.forEach((review) => {
            const key = getReviewKey(review);
            const savedReview = latestReviews.get(key);
            if (!savedReview || Date.parse(review.date) > Date.parse(savedReview.date)) {
                latestReviews.set(key, review);
            }
        });
        const deduplicatedReviews = [...latestReviews.values()].sort((left, right) => Date.parse(right.date) - Date.parse(left.date));
        if (deduplicatedReviews.length !== parsedHistory.length) {
            try {
                localStorage.setItem(reviewHistoryKey, JSON.stringify(deduplicatedReviews));
            } catch (error) {
                console.error("Could not remove duplicate review history entries.", error);
                historyNotice.hidden = false;
                historyNotice.textContent = "Duplicate saved reviews could not be cleaned up in this browser. Check available storage.";
            }
        }
        return deduplicatedReviews;
    } catch (error) {
        console.error("Could not load saved review history.", error);
        historyNotice.hidden = false;
        historyNotice.textContent = "Saved review history could not be loaded from this browser.";
        return [];
    }
}

function saveReviewHistory() {
    try {
        localStorage.setItem(reviewHistoryKey, JSON.stringify(reviewHistory));
        historyNotice.hidden = true;
        historyNotice.textContent = "";
        return true; 
    } catch (error) {
        console.error("Could not save review history.", error);
        historyNotice.hidden = false;
        historyNotice.textContent = "This review is visible now but could not be saved in this browser. Check available storage and try again.";
        return false;
    }
}

function savePublishedReview(item) {
    const words = item.content.trim().match(/\S+/g) || [];
    const review = {
        id: item.id,
        date: item.decisionDate || new Date().toISOString(),
        title: item.title,
        type: item.type,
        content: item.content,
        wordCount: words.length,
        appliedCount: 0,
        categories: [...new Set(item.findings.map((finding) => finding.category).filter(Boolean))],
        findings: item.findings.map((finding) => ({
            id: finding.id,
            title: finding.title,
            category: finding.category,
            severity: finding.severity
        })),
        status: "published"
    };
    const previousHistory = reviewHistory;
    reviewHistory = [
        review,
        ...reviewHistory.filter((savedReview) =>
            getReviewKey(savedReview) !== getReviewKey(review)
        )
    ];
    if (!saveReviewHistory()) {
        reviewHistory = previousHistory;
        return false;
    }
    renderReviewHistory();
    updateInsights();
    return true;
}

function loadApprovalQueue() {
    try {
        const savedQueue = localStorage.getItem(approvalQueueKey);
        if (!savedQueue) return [];
        const parsedQueue = JSON.parse(savedQueue);
        if (!Array.isArray(parsedQueue)) throw new Error("Approval queue data is not a list.");
        const validItems = parsedQueue.filter((item) =>
            item && typeof item.id === "string" &&
            typeof item.title === "string" &&
            typeof item.type === "string" &&
            typeof item.date === "string" &&
            Number.isFinite(Date.parse(item.date)) &&
            typeof item.content === "string" &&
            ["pending", "approved", "published", "changes_requested"].includes(item.status) &&
            Array.isArray(item.findings)
        );
        const latestByTitle = new Map();
        validItems.forEach((item) => {
            const key = item.title.trim().toLocaleLowerCase();
            const savedItem = latestByTitle.get(key);
            const itemDate = Date.parse(item.decisionDate || item.date);
            const savedDate = savedItem ? Date.parse(savedItem.decisionDate || savedItem.date) : -Infinity;
            if (!savedItem || itemDate > savedDate) latestByTitle.set(key, item);
        });
        const latestItems = [...latestByTitle.values()].sort((left, right) =>
            Date.parse(right.decisionDate || right.date) - Date.parse(left.decisionDate || left.date)
        );
        if (latestItems.length !== validItems.length || validItems.length !== parsedQueue.length) {
            try {
                localStorage.setItem(approvalQueueKey, JSON.stringify(latestItems));
            } catch (error) {
                console.error("Could not remove duplicate approval history entries.", error);
                historyNotice.hidden = false;
                historyNotice.textContent = "Duplicate manager history entries could not be cleaned up in this browser.";
            }
        }
        return latestItems;
    } catch (error) {
        console.error("Could not load the approval queue.", error);
        historyNotice.hidden = false;
        historyNotice.textContent = "The saved approval inbox could not be loaded from this browser.";
        return [];
    }
}

function saveApprovalQueue() {
    try {
        localStorage.setItem(approvalQueueKey, JSON.stringify(approvalQueue));
        return true;
    } catch (error) {
        console.error("Could not save the approval queue.", error);
        historyNotice.hidden = false;
        historyNotice.textContent = "The approval decision could not be saved in this browser. Check available storage and try again.";
        return false;
    }
}

function snapshotApprovalVersion(item) {
    return {
        id: item.id,
        date: item.date,
        decisionDate: item.decisionDate || "",
        title: item.title,
        type: item.type,
        content: item.content,
        wordCount: item.wordCount,
        status: item.status,
        rejectionReason: item.rejectionReason || "",
        findings: item.findings.map((finding) => ({
            title: finding.title,
            category: finding.category,
            severity: finding.severity
        }))
    };
}

function renderVersionTimeline(item, currentStatus) {
    const versions = [...(Array.isArray(item.versionHistory) ? item.versionHistory : []), {
        ...snapshotApprovalVersion(item),
        status: currentStatus || item.status
    }].sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
    if (versions.length < 2) return null;
    const details = createElement("details", "version-timeline");
    details.append(createElement("summary", "", `Version history · ${versions.length} versions`));
    const list = createElement("ol", "version-timeline-list");
    versions.forEach((entry, index) => {
        const row = createElement("li", "version-timeline-item");
        const statusLabel = entry.status === "changes_requested"
            ? "Changes requested"
            : entry.status === "published"
                ? "Published"
                : entry.status === "approved"
                    ? "Approved"
                    : entry.status === "pending"
                        ? "Pending approval"
                        : "Draft submitted";
        const header = createElement("div", "version-timeline-heading");
        header.append(
            createElement("strong", "", `Version ${index + 1}`),
            createElement("span", `version-status is-${entry.status}`, statusLabel),
            createElement("time", "", new Date(entry.decisionDate || entry.date).toLocaleString())
        );
        const content = createElement("p", "", entry.content);
        row.append(header, content);
        if (entry.rejectionReason) {
            const feedback = createElement("p", "version-timeline-feedback");
            feedback.append(createElement("strong", "", "Manager feedback: "), document.createTextNode(entry.rejectionReason));
            row.append(feedback);
        }
        list.append(row);
    });
    details.append(list);
    return details;
}

function renderManagerInbox() {
    const inbox = document.getElementById("managerInbox");
    const filter = document.getElementById("managerFilter").value;
    const query = document.getElementById("managerSearch").value.trim().toLocaleLowerCase();
    const allPending = approvalQueue.filter((item) => item.status === "pending");
    const selectedItems = filter === "revised"
        ? approvalQueue.filter((item) => item.status === "pending" && item.isRevision)
        : filter === "changes_requested"
            ? approvalQueue.filter((item) => item.status === "changes_requested")
            : allPending;
    const visibleItems = selectedItems.filter((item) =>
        !query || `${item.title} ${item.type} ${item.content} ${item.rejectionReason || ""}`.toLocaleLowerCase().includes(query)
    );
    document.getElementById("pendingApprovalCount").textContent = `${allPending.length} pending`;
    document.getElementById("managerFilterCount").textContent = `${visibleItems.length} approval items shown`;
    inbox.replaceChildren();
    renderManagerHistory();

    if (!visibleItems.length) {
        const empty = createElement("div", "manager-empty");
        const emptyMessage = filter === "changes_requested"
            ? "No change requests match this search."
            : filter === "revised"
                ? "No revised submissions match this search."
                : allPending.length
                    ? "No pending approvals match this search."
                    : "Only content submitted for approval appears in this inbox.";
        empty.append(
            createDecorativeIcon("manager-empty-icon", "✓"),
            createElement("strong", "", filter === "pending" && !allPending.length ? "You're all caught up" : "No matching items"),
            createElement("p", "", emptyMessage)
        );
        inbox.append(empty);
        return;
    }

    visibleItems.forEach((item) => {
        const card = createElement("article", "approval-card");
        if (item.status === "changes_requested") card.classList.add("is-changes-requested");
        const header = createElement("div", "approval-card-header");
        const identity = createElement("div");
        identity.append(
            createElement("span", "approval-type", item.type),
            createElement("h2", "", item.title)
        );
        header.append(
            identity,
            createElement(
                "span",
                `approval-pending-label${item.status === "changes_requested" ? " is-rejected" : item.isRevision ? " is-revision" : ""}`,
                item.status === "changes_requested" ? "Changes requested" : item.isRevision ? "Revised content" : "Pending approval"
            )
        );
        if (item.isRevision) {
            const revisionNotice = createElement("div", "revision-notice");
            const noticeCopy = item.revisionReason === "changes_requested"
                ? "Resubmitted after changes were requested. Compare it with the previous submission."
                : "Updated since the last approved version. Review the changes before approving.";
            revisionNotice.append(createElement("strong", "", noticeCopy));
            const comparison = createElement("details", "revision-comparison");
            comparison.append(createElement("summary", "", "Compare previous and current versions"));
            const versions = createElement("div", "revision-versions");
            const previousVersion = createElement("div", "revision-version");
            previousVersion.append(createElement("span", "", "Previous version"), createElement("p", "", item.previousContent));
            const currentVersion = createElement("div", "revision-version is-current");
            currentVersion.append(createElement("span", "", "Current revision"), createElement("p", "", item.content));
            versions.append(previousVersion, currentVersion);
            comparison.append(versions);
            revisionNotice.append(comparison);
            card.append(header, revisionNotice);
        } else {
            card.append(header);
        }
        const meta = createElement("div", "approval-meta");
        meta.append(
            createElement("span", "", `Submitted ${new Date(item.date).toLocaleString()}`),
            createElement("span", "", `${item.wordCount} words`),
            createElement("span", "", `${item.findings.length} guideline finding${item.findings.length === 1 ? "" : "s"}`)
        );

        const content = createElement("details", "approval-content");
        content.append(
            createElement("summary", "", item.status === "changes_requested" ? "Read rejected content" : "Read submitted content"),
            createElement("p", "", item.content)
        );

        const findings = createElement("div", "approval-findings");
        if (item.findings.length) {
            item.findings.forEach((finding) => {
                const row = createElement("div", "approval-finding");
                row.append(
                    createElement("span", `history-severity severity-${finding.severity}`, finding.severity),
                    createElement("span", "", finding.title)
                );
                findings.append(row);
            });
        } else {
            findings.append(createElement("span", "history-clear", "No demo guideline issues found"));
        }

        if (item.status === "changes_requested") {
            const feedback = createElement("div", "rejection-reason-copy");
            feedback.append(
                createElement("strong", "", "Reason sent to creator"),
                createElement("p", "", item.rejectionReason || "No reason was recorded.")
            );
            card.append(meta, content, findings, feedback);
            const timeline = renderVersionTimeline(item);
            if (timeline) card.append(timeline);
            inbox.append(card);
            return;
        }

        const actions = createElement("div", "approval-actions");
        const rejectionFeedback = createElement("div", "rejection-feedback");
        const rejectionReason = createElement("textarea", "rejection-reason");
        rejectionReason.rows = 3;
        rejectionReason.maxLength = 500;
        rejectionReason.placeholder = "Explain what needs to change before this can be approved…";
        rejectionReason.setAttribute("aria-label", `Reason for requesting changes to ${item.title}`);
        rejectionReason.dataset.rejectionReason = "true";
        const rejectionError = createElement("span", "rejection-error");
        rejectionError.id = `rejection-error-${item.id}`;
        rejectionError.setAttribute("role", "alert");
        rejectionError.hidden = true;
        rejectionReason.setAttribute("aria-describedby", rejectionError.id);
        rejectionReason.addEventListener("input", () => {
            rejectionReason.removeAttribute("aria-invalid");
            rejectionError.hidden = true;
        });
        rejectionFeedback.append(rejectionReason, rejectionError);
        const requestChanges = createElement("button", "button button-secondary", "Request changes");
        requestChanges.type = "button";
        requestChanges.dataset.approvalAction = "changes";
        requestChanges.dataset.approvalId = item.id;
        const approve = createElement("button", "button button-primary", "Approve content");
        approve.type = "button";
        approve.dataset.approvalAction = "approve";
        approve.dataset.approvalId = item.id;
        actions.append(rejectionFeedback, requestChanges, approve);
        card.append(meta, content, findings, actions);
        const timeline = renderVersionTimeline(item);
        if (timeline) card.append(timeline);
        inbox.append(card);
    });
}

function renderCreatorRejections() {
    const list = document.getElementById("rejectionList");
    const rejectedItems = approvalQueue
        .filter((item) => item.status === "changes_requested")
        .sort((left, right) => Date.parse(right.decisionDate || right.date) - Date.parse(left.decisionDate || left.date));
    document.getElementById("rejectionCount").textContent = `${rejectedItems.length} item${rejectedItems.length === 1 ? "" : "s"}`;
    list.replaceChildren();
    if (!rejectedItems.length) {
        const empty = createElement("div", "history-empty");
        empty.append(
            createElement("strong", "", "No changes requested"),
            createElement("p", "", "Manager feedback for rejected submissions will appear here.")
        );
        list.append(empty);
        return;
    }

    rejectedItems.forEach((item) => {
        const card = createElement("article", "rejection-card");
        const header = createElement("div", "history-card-top");
        const identity = createElement("div");
        identity.append(
            createElement("span", "history-type", item.type),
            createElement("h3", "", item.title)
        );
        header.append(
            identity,
            createElement("time", "history-date", `Changes requested ${new Date(item.decisionDate || item.date).toLocaleString()}`)
        );
        const reason = createElement("div", "rejection-reason-copy");
        reason.append(
            createElement("strong", "", "Manager's reason"),
            createElement("p", "", item.rejectionReason || "No reason was recorded.")
        );
        const content = createElement("details", "history-content");
        content.append(createElement("summary", "", "View rejected content"), createElement("p", "", item.content));
        const actions = createElement("div", "approval-actions");
        const reviewAgain = createElement("button", "button button-primary", "Review again");
        reviewAgain.type = "button";
        reviewAgain.dataset.rejectionAction = "review-again";
        reviewAgain.dataset.approvalId = item.id;
        actions.append(reviewAgain);
        card.append(header, reason, content, actions);
        const timeline = renderVersionTimeline(item);
        if (timeline) card.append(timeline);
        list.append(card);
    });
}

function handleReviewAgain(approvalId) {
    const item = approvalQueue.find((entry) => entry.id === approvalId && entry.status === "changes_requested");
    if (!item) return;
    const contentType = [...document.getElementById("contentType").options].find((option) => option.text === item.type);
    if (contentType) document.getElementById("contentType").value = contentType.value;
    document.getElementById("editorTitle").textContent = item.title;
    editor.textContent = item.content;
    draftBaselineText = item.content;
    document.getElementById("draftFile").value = "";
    importedMarkup = "";
    importedAsset = "";
    currentFindings = [];
    resolvedFindings = [];
    scanHasRun = false;
    workflowState = "draft";
    activeApprovalId = null;
    publishedDraftLocked = false;
    draftNotice = `The manager requested changes: ${item.rejectionReason || "Review the feedback before resubmitting."}`;
    version += 1;
    document.getElementById("versionNumber").textContent = String(version);
    document.getElementById("roundBackBtn").hidden = false;
    addActivity(`reopened “${item.title}” after manager feedback.`);
    updateWordCount();
    updateReviewUI();
    scheduleDraftSave();
    lastLoadedPublishedId = approvalQueue
        .filter((entry) => entry.status === "published")
        .sort((left, right) => Date.parse(right.decisionDate || right.date) - Date.parse(left.decisionDate || left.date))[0]?.id || null;
    window.location.hash = "#workspace";
    setActiveView("workspace");
    editor.focus();
}

function renderManagerHistory() {
    const history = document.getElementById("managerHistory");
    const approvedItems = approvalQueue
        .filter((item) => item.status === "approved" || item.status === "published")
        .sort((left, right) => Date.parse(right.decisionDate || right.date) - Date.parse(left.decisionDate || left.date));
    document.getElementById("approvedCount").textContent = `${approvedItems.length} approved`;
    history.replaceChildren();

    if (!approvedItems.length) {
        const empty = createElement("div", "history-empty");
        empty.append(
            createElement("strong", "", "No approved content yet"),
            createElement("p", "", "Your completed approval decisions will be listed here.")
        );
        history.append(empty);
        return;
    }

    approvedItems.forEach((item) => {
        const card = createElement("article", "manager-history-card");
        const header = createElement("div", "history-card-top");
        const identity = createElement("div");
        identity.append(
            createElement("span", "history-type", item.type),
            createElement("h3", "", item.title)
        );
        header.append(
            identity,
            createElement("span", `approval-approved-label${item.status === "published" ? " is-published" : ""}`, item.status === "published" ? "Published" : "Approved")
        );
        const meta = createElement("div", "approval-meta");
        meta.append(
            createElement("span", "", `${item.status === "published" ? "Published" : "Approved"} ${new Date(item.decisionDate || item.date).toLocaleString()}`),
            createElement("span", "", `${item.wordCount} words`),
            createElement("span", "", `${item.findings.length} guideline finding${item.findings.length === 1 ? "" : "s"} at submission`)
        );
        const content = createElement("details", "approval-content");
        content.append(
            createElement("summary", "", "Read approved content"),
            createElement("p", "", item.content)
        );
        card.append(header, meta, content);
        const timeline = renderVersionTimeline(item);
        if (timeline) card.append(timeline);
        if (item.status === "approved") {
            const actions = createElement("div", "approval-actions");
            const publish = createElement("button", "button button-primary", "Publish");
            publish.type = "button";
            publish.dataset.approvalAction = "publish";
            publish.dataset.approvalId = item.id;
            actions.append(publish);
            card.append(actions);
        }
        history.append(card);
    });
}

function loadPublishedContent(item) {
    const contentType = [...document.getElementById("contentType").options].find((option) =>
        option.text === item.type
    );
    if (contentType) document.getElementById("contentType").value = contentType.value;
    document.getElementById("editorTitle").textContent = item.title;
    editor.textContent = item.content;
    draftBaselineText = item.content;
    document.getElementById("versionNumber").textContent = String(++version);
    document.getElementById("draftFile").value = "";
    importedMarkup = "";
    importedAsset = "";
    resolvedFindings = [];
    currentFindings = [];
    scanHasRun = false;
    workflowState = "draft";
    activeApprovalId = null;
    publishedDraftLocked = true;
    draftNotice = "";
    updateWordCount();
    updateReviewUI();
    document.getElementById("roundBackBtn").hidden = false;
    addActivity(`loaded the latest published version of “${item.title}” as the starting point for a new draft.`);
    lastLoadedPublishedId = item.id;
}

function refreshPublishedContent() {
    const latestPublished = approvalQueue
        .filter((item) => item.status === "published")
        .sort((left, right) =>
            Date.parse(right.decisionDate || right.date) - Date.parse(left.decisionDate || left.date)
        )[0];
    if (!latestPublished || latestPublished.id === lastLoadedPublishedId) return;
    loadPublishedContent(latestPublished);
}

function renderReviewHistory() {
    reviewHistoryContainer.replaceChildren();
    document.getElementById("historyCount").textContent = `${reviewHistory.length} review${reviewHistory.length === 1 ? "" : "s"}`;

    if (!reviewHistory.length) {
        const empty = createElement("div", "history-empty");
        empty.append(
            createElement("strong", "", "No reviewed content yet"),
            createElement("p", "", "Run a guideline review in the workspace. Saved reviews will appear here.")
        );
        reviewHistoryContainer.append(empty);
        return;
    }

    reviewHistory.forEach((review) => {
        const card = createElement("article", "history-card");
        const top = createElement("div", "history-card-top");
        const identity = createElement("div");
        identity.append(createElement("span", "history-type", review.type));
        identity.append(createElement("h3", "", review.title));
        top.append(identity, createElement("time", "history-date", new Date(review.date).toLocaleString()));

        const summary = createElement("div", "history-summary");
        summary.append(
            createElement("span", "history-result", `${review.findings.length} finding${review.findings.length === 1 ? "" : "s"}`),
            createElement("span", "", `${review.wordCount} words`)
        );
        if (review.categories.length) {
            summary.append(createElement("span", "history-categories", review.categories.join(" · ")));
        }

        const findings = createElement("div", "history-findings");
        if (review.findings.length) {
            review.findings.forEach((finding) => {
                const findingLine = createElement("div", "history-finding");
                findingLine.append(
                    createElement("span", `history-severity severity-${finding.severity}`, finding.severity),
                    createElement("span", "", finding.title)
                );
                findings.append(findingLine);
            });
        } else {
            findings.append(createElement("span", "history-clear", "No demo guideline issues found"));
        }

        const content = createElement("details", "history-content");
        const summaryLabel = createElement("summary", "", "View reviewed content");
        content.append(summaryLabel, createElement("p", "", review.content));

        card.append(top, summary, findings, content);
        const approvalRecord = approvalQueue.find((item) =>
            item.title.trim().toLocaleLowerCase() === review.title.trim().toLocaleLowerCase()
        );
        if (approvalRecord) {
            const timeline = renderVersionTimeline(approvalRecord);
            if (timeline) card.append(timeline);
        }
        reviewHistoryContainer.append(card);
    });
}

function getViewFromHash() {
    const hash = window.location.hash;
    if (hash === "#insights") return "insights";
    if (hash === "#manual" || hash.startsWith("#manual-")) return "manual";
    return "workspace";
}

function setActiveView(view) {
    const showManual = view === "manual";
    const showManager = roleSelect.value === "manager" && !showManual;
    const showInsights = view === "insights" && !showManager;
    const showWorkspace = !showManual && !showInsights && !showManager;
    const profile = roleSelect.value === "manager"
        ? { name: "Jordan Lee · Manager", initials: "JL" }
        : roleSelect.value === "reviewer"
            ? { name: "Taylor Kim · Authorised reviewer", initials: "TK" }
            : { name: "Alex Morgan · Creator", initials: "AM" };
    document.getElementById("workspaceView").hidden = !showWorkspace;
    document.getElementById("managerView").hidden = !showManager;
    document.getElementById("insights").hidden = !showInsights;
    document.getElementById("manual").hidden = !showManual;
    const avatar = document.querySelector(".avatar");
    avatar.title = profile.name;
    avatar.setAttribute("aria-label", profile.name);
    avatar.textContent = profile.initials;
    const workspaceLink = document.querySelector('.nav-link[href="#workspace"]');
    workspaceLink.textContent = showManager ? "Approval inbox" : "Workspace";
    document.querySelector('.nav-link[href="#insights"]').hidden = roleSelect.value === "manager";
    const activeHash = showManual ? "#manual" : showInsights ? "#insights" : "#workspace";
    document.querySelectorAll(".nav-link").forEach((link) => {
        const active = link.hash === activeHash;
        link.classList.toggle("active", active);
        if (active) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
    });
    if (showManager) renderManagerInbox();
    if (showWorkspace) refreshPublishedContent();
    if (showInsights) {
        renderCreatorRejections();
        renderReviewHistory();
        updateInsights();
    }
    document.title = showManual
        ? "User Manual | Inkloom"
        : showInsights
            ? "Review Insights | Inkloom"
            : showManager
                ? "Approval Inbox | Inkloom"
                : "Inkloom | Brand Content Review & Approval Workspace";
}

function updateWorkflow() {
    const canReview = roleSelect.value !== "creator";
    const statusText = draftNotice.startsWith("The manager requested changes:")
        ? "Changes requested"
        : workflowState === "in_review"
            ? "Awaiting approval"
            : workflowState === "approved"
                ? "Approved"
                : workflowState === "published"
                    ? "Published"
                    : "Draft";
    workflowStatus.textContent = statusText;
    workflowStatus.dataset.state = statusText.toLocaleLowerCase().replace(/\s+/g, "-");
    const workflowSteps = [
        { element: document.getElementById("draftStep"), active: workflowState === "draft" },
        { element: document.getElementById("reviewStep"), active: workflowState === "in_review" },
        { element: document.getElementById("approvedStep"), active: workflowState === "approved" || workflowState === "published" }
    ];
    workflowSteps.forEach(({ element, active }) => {
        element.classList.toggle("active", active);
        element.classList.toggle("complete", !active && (
            element.id === "draftStep" && workflowState !== "draft" ||
            element.id === "reviewStep" && ["approved", "published"].includes(workflowState) ||
            element.id === "approvedStep" && workflowState === "published"
        ));
        if (active) element.setAttribute("aria-current", "step");
        else element.removeAttribute("aria-current");
    });
    document.querySelector("#approvedStep strong").textContent = workflowState === "published" ? "Published" : "Approved";
    document.querySelector("#approvedStep small").textContent = workflowState === "published" ? "Live" : "Ready to publish";

    const blockers = currentFindings.filter((finding) => finding.severity === "high" || finding.severity === "critical").length;
    workflowActionBtn.hidden = !scanHasRun || workflowState === "published" ||
        (workflowState === "in_review" && !canReview) ||
        (workflowState === "approved" && !canReview);
    if (workflowState === "in_review") {
        workflowActionBtn.textContent = "Approve draft";
    } else if (workflowState === "approved") {
        workflowActionBtn.textContent = "Publish";
    } else {
        workflowActionBtn.textContent = "Request approval";
    }
    workflowActionBtn.disabled = blockers > 0;
    workflowActionBtn.title = blockers ? `Resolve ${blockers} high-risk finding${blockers === 1 ? "" : "s"} before continuing.` : "";
    document.getElementById("scanBtn").hidden = publishedDraftLocked;
    document.getElementById("checkAgainBtn").hidden = publishedDraftLocked;
}

function updateScanSummary() {
    const openCount = currentFindings.length;
    const blockerCount = currentFindings.filter((finding) => finding.severity === "high" || finding.severity === "critical").length;
    const findingsCount = document.getElementById("findingsCount");
    scanSummary.className = "scan-summary";

    if (!scanHasRun) {
        findingsCount.textContent = "Not reviewed";
        const title = draftNotice ? "Review needs to be run again" : "Ready when you are";
        const description = draftNotice || "Review your draft to see explainable suggestions from the GreenSteps demo guidelines.";
        scanSummary.replaceChildren(createDecorativeIcon("summary-icon", draftNotice ? "↻" : "✦"), createElement("div"));
        const copy = scanSummary.lastElementChild;
        copy.append(createElement("strong", "", title), createElement("p", "", description));
        return;
    }

    if (blockerCount) {
        scanSummary.classList.add("has-blockers");
        findingsCount.textContent = `${openCount} open`;
        const title = `${blockerCount} high-risk ${blockerCount === 1 ? "item needs" : "items need"} attention`;
        const description = "Recommendations explain the rule match. Review and edit each change before requesting approval.";
        scanSummary.replaceChildren(createDecorativeIcon("summary-icon", "!"), createElement("div"));
        scanSummary.lastElementChild.append(createElement("strong", "", title), createElement("p", "", description));
    } else if (openCount) {
        findingsCount.textContent = `${openCount} advisory`;
        scanSummary.classList.add("all-clear");
        scanSummary.replaceChildren(createDecorativeIcon("summary-icon", "✓"), createElement("div"));
        scanSummary.lastElementChild.append(
            createElement("strong", "", "No high-risk blockers"),
            createElement("p", "", `${openCount} advisory item${openCount === 1 ? " remains" : "s remain"} for your team to review.`)
        );
    } else {
        findingsCount.textContent = "Clear";
        scanSummary.classList.add("all-clear");
        scanSummary.replaceChildren(createDecorativeIcon("summary-icon", "✓"), createElement("div"));
        scanSummary.lastElementChild.append(
            createElement("strong", "", "No demo guideline issues found"),
            createElement("p", "", "Automated checks are not a substitute for human fact-checking and approval.")
        );
    }
}

function updateReviewUI() {
    renderFindings();
    updateScanSummary();
    updateWorkflow();
    updateInsights();
}

function addActivity(message, actor = "Alex Morgan") {
    const item = createElement("li", "activity-item");
    const description = createElement("span");
    description.append(createElement("strong", "", actor), document.createTextNode(` ${message}`));
    item.append(description);
    const time = createElement("time", "", new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    item.append(time);
    activityList.prepend(item);
}

function runSimulationScan() {
    if (workflowState !== "draft") {
        workflowState = "draft";
        addActivity("started a new review after the draft changed.");
    }
    currentFindings = detectFindings();
    scanHasRun = true;
    draftNotice = "";
    scanCount += 1;
    const words = getDraftText().trim().match(/\S+/g) || [];
    const contentTypeSelect = document.getElementById("contentType");
    const review = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        date: new Date().toISOString(),
        title: document.getElementById("editorTitle").textContent.trim(),
        type: contentTypeSelect.selectedOptions[0].text,
        content: getDraftText(),
        wordCount: words.length,
        appliedCount,
        categories: [...new Set(currentFindings.map((finding) => finding.category))],
        findings: currentFindings.map((finding) => ({
            id: finding.id,
            title: finding.title,
            category: finding.category,
            severity: finding.severity
        }))
    };
    const existingIndex = reviewHistory.findIndex((savedReview) => getReviewKey(savedReview) === getReviewKey(review));
    if (existingIndex !== -1) {
        review.id = reviewHistory[existingIndex].id;
        reviewHistory.splice(existingIndex, 1);
    }
    reviewHistory.unshift(review);
    saveReviewHistory();
    renderReviewHistory();
    appliedCount = 0;
    currentFindings.forEach((finding) => {
        issueFrequency[finding.category] = (issueFrequency[finding.category] || 0) + 1;
    });
    document.getElementById("roundBackBtn").hidden = false;
    addActivity(`ran a guideline review and found ${currentFindings.length} item${currentFindings.length === 1 ? "" : "s"}.`);
    updateReviewUI();
    const blockerCount = currentFindings.filter((finding) => finding.severity === "high" || finding.severity === "critical").length;
    document.getElementById("reviewAnnouncement").textContent = currentFindings.length
        ? `Review complete. ${currentFindings.length} finding${currentFindings.length === 1 ? "" : "s"}${blockerCount ? `, including ${blockerCount} approval blocker${blockerCount === 1 ? "" : "s"}` : ""}.`
        : "Review complete. No guideline findings.";
}

function applySuggestion(issueId) {
    const issueIndex = currentFindings.findIndex((finding) => finding.id === issueId);
    if (issueIndex === -1) return;
    const finding = currentFindings[issueIndex];
    const hasUnapprovedCopyChange = currentFindings.some((item) => item.id === "custom-copy-change");

    if (finding.replaceText !== null && finding.replaceText) {
        const text = getDraftText();
        const matchIndex = text.indexOf(finding.replaceText);
        if (matchIndex === -1) {
            draftNotice = "This finding no longer matches the edited draft. Run the review again to refresh its suggestions.";
            scanHasRun = false;
            currentFindings = [];
            updateReviewUI();
            return;
        }
        editor.textContent = text.slice(0, matchIndex) + finding.replacement + text.slice(matchIndex + finding.replaceText.length);
        if (!hasUnapprovedCopyChange && finding.id !== "product-copy-changed") {
            draftBaselineText = getDraftText();
        }
        version += 1;
        document.getElementById("versionNumber").textContent = String(version);
        if (finding.id === "visual-consistency") importedAsset = "";
        if (finding.id === "accessibility") importedMarkup = "";
        appliedCount += 1;
        addActivity(`applied a suggested change for “${finding.category}”.`);
    } else {
        finding.reviewedOnly = true;
        addActivity(`marked “${finding.title}” for human verification.`);
    }

    finding.resolved = true;
    resolvedFindings.push(finding);
    currentFindings.splice(issueIndex, 1);
    updateWordCount();
    updateReviewUI();
    scheduleDraftSave();
    document.getElementById("reviewAnnouncement").textContent = finding.reviewedOnly
        ? `Marked ${finding.title} for human verification.`
        : `Applied the suggestion for ${finding.title}.`;
    const nextAction = issueList.querySelector("button[data-issue-id]") || document.getElementById("scanBtn");
    nextAction.focus();
}

function updateWordCount() {
    const words = getDraftText().trim().match(/\S+/g) || [];
    document.getElementById("wordCount").textContent = `${words.length} word${words.length === 1 ? "" : "s"}`;
}

function invalidateReview() {
    if (publishedDraftLocked) {
        publishedDraftLocked = false;
        version += 1;
        document.getElementById("versionNumber").textContent = String(version);
        addActivity("started a new draft from the published content.");
    }
    const hadReview = scanHasRun || workflowState !== "draft";
    let invalidationMessage = "The draft changed after its last review. Re-run checks before approval.";
    if (workflowState !== "draft") {
        workflowState = "draft";
        addActivity("edited the draft; the previous approval state is no longer current.");
    }
    if (activeApprovalId) {
        const pendingItem = approvalQueue.find((item) => item.id === activeApprovalId && item.status === "pending");
        if (pendingItem) {
            pendingItem.status = "changes_requested";
            pendingItem.decisionDate = new Date().toISOString();
            if (!saveApprovalQueue()) {
                pendingItem.status = "pending";
                delete pendingItem.decisionDate;
                invalidationMessage = "The draft changed, but its pending approval could not be withdrawn. Check available browser storage.";
            }
        }
        activeApprovalId = null;
        renderManagerInbox();
    }
    if (hadReview) {
        scanHasRun = false;
        currentFindings = [];
        draftNotice = invalidationMessage;
    }
    updateWordCount();
    updateReviewUI();
    if (hadReview) document.getElementById("reviewAnnouncement").textContent = invalidationMessage;
    scheduleDraftSave();
}

function resetToStart() {
    editor.textContent = sampleDrafts.web;
    draftBaselineText = sampleDrafts.web;
    document.getElementById("contentType").value = "web";
    document.getElementById("draftFile").value = "";
    document.getElementById("versionNumber").textContent = "1";
    roleSelect.value = "creator";
    currentFindings = [];
    resolvedFindings = [];
    scanHasRun = false;
    workflowState = "draft";
    publishedDraftLocked = false;
    version = 1;
    appliedCount = 0;
    scanCount = 0;
    activeApprovalId = null;
    issueFrequency = {};
    importedMarkup = "";
    importedAsset = "";
    draftNotice = "";
    activityList.replaceChildren();
    addActivity("created the example draft.");
    updateWordCount();
    updateReviewUI();
    scheduleDraftSave();
    document.getElementById("roundBackBtn").hidden = true;
}

function loadContentTypeSample() {
    const contentType = document.getElementById("contentType").value;
    editor.textContent = sampleDrafts[contentType];
    draftBaselineText = sampleDrafts[contentType];
    importedMarkup = "";
    importedAsset = "";
    document.getElementById("draftFile").value = "";
    currentFindings = [];
    resolvedFindings = [];
    scanHasRun = false;
    workflowState = "draft";
    publishedDraftLocked = false;
    activeApprovalId = null;
    draftNotice = "";
    version += 1;
    document.getElementById("versionNumber").textContent = String(version);
    document.getElementById("roundBackBtn").hidden = true;
    addActivity(`loaded the ${document.getElementById("contentType").selectedOptions[0].text.toLowerCase()} sample draft.`);
    updateWordCount();
    updateReviewUI();
    scheduleDraftSave();
}

function handleWorkflowAction() {
    const blockers = currentFindings.filter((finding) => finding.severity === "high" || finding.severity === "critical").length;
    if (blockers) {
        draftNotice = `Resolve ${blockers} high-risk finding${blockers === 1 ? "" : "s"} before requesting approval.`;
        scanHasRun = false;
        updateReviewUI();
        return;
    }

    if (workflowState === "draft") {
        const words = getDraftText().trim().match(/\S+/g) || [];
        const contentTypeSelect = document.getElementById("contentType");
        const title = document.getElementById("editorTitle").textContent.trim();
        const priorVersion = approvalQueue
            .filter((item) =>
                item.title.trim().toLocaleLowerCase() === title.toLocaleLowerCase() &&
                ["approved", "published", "changes_requested"].includes(item.status)
            )
            .sort((left, right) =>
                Date.parse(right.decisionDate || right.date) - Date.parse(left.decisionDate || left.date)
            )[0];
        const currentContent = getDraftText();
        const isRevision = Boolean(priorVersion && (
            priorVersion.status === "changes_requested" ||
            priorVersion.content !== currentContent
        ));
        const submittedReview = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            date: new Date().toISOString(),
            title,
            type: contentTypeSelect.selectedOptions[0].text,
            content: currentContent,
            wordCount: words.length,
            findings: currentFindings.map((finding) => ({
                id: finding.id,
                title: finding.title,
                category: finding.category,
                severity: finding.severity
            })),
            isRevision,
            revisionReason: isRevision ? priorVersion.status : "",
            previousContent: isRevision ? priorVersion.content : "",
            versionHistory: priorVersion
                ? [...(Array.isArray(priorVersion.versionHistory) ? priorVersion.versionHistory : []), snapshotApprovalVersion(priorVersion)].slice(-19)
                : [],
            status: "pending"
        };
        const previousQueue = approvalQueue;
        approvalQueue = approvalQueue.filter((item) =>
            item.title.trim().toLocaleLowerCase() !== submittedReview.title.trim().toLocaleLowerCase()
        );
        approvalQueue.unshift(submittedReview);
        if (!saveApprovalQueue()) {
            approvalQueue = previousQueue;
            updateReviewUI();
            return;
        }
        activeApprovalId = submittedReview.id;
        workflowState = "in_review";
        clearSavedDraft();
        setDraftSaveStatus("Submission saved for approval");
        addActivity("requested manager approval.");
        renderManagerInbox();
    } else if (workflowState === "in_review" && roleSelect.value !== "creator") {
        workflowState = "approved";
        addActivity("approved this version for publication.", roleSelect.value === "manager" ? "Jordan Lee · Manager" : "Taylor Kim · Authorised reviewer");
    } else if (workflowState === "approved" && roleSelect.value !== "creator") {
        workflowState = "published";
        addActivity("published this approved version.", roleSelect.value === "manager" ? "Jordan Lee · Manager" : "Taylor Kim · Authorised reviewer");
    }
    updateReviewUI();
}

function handleApprovalDecision(action, approvalId, rejectionReason = "") {
    const itemIndex = approvalQueue.findIndex((item) => item.id === approvalId && item.status === "pending");
    if (itemIndex === -1) return;
    const item = approvalQueue[itemIndex];
    const previousStatus = item.status;
    const previousReason = item.rejectionReason;
    item.status = action === "approve" ? "approved" : "changes_requested";
    if (action === "changes") item.rejectionReason = rejectionReason;
    else delete item.rejectionReason;
    item.decisionDate = new Date().toISOString();
    if (!saveApprovalQueue()) {
        item.status = previousStatus;
        if (previousReason === undefined) delete item.rejectionReason;
        else item.rejectionReason = previousReason;
        delete item.decisionDate;
        renderManagerInbox();
        return;
    }
    addActivity(
        action === "approve"
            ? `approved “${item.title}”.`
            : `requested changes to “${item.title}”.`,
        "Jordan Lee · Manager"
    );
    const isCurrentDraft = item.id === activeApprovalId;
    if (isCurrentDraft) {
        activeApprovalId = null;
        workflowState = action === "approve" ? "approved" : "draft";
        if (action === "changes") {
            scanHasRun = false;
            currentFindings = [];
            draftNotice = "The manager requested changes. Update the draft and review it again before resubmitting.";
        }
        updateReviewUI();
    }
    renderManagerInbox();
}

function handlePublishApproval(approvalId) {
    const item = approvalQueue.find((entry) => entry.id === approvalId && entry.status === "approved");
    if (!item) return;
    item.status = "published";
    item.decisionDate = new Date().toISOString();
    if (!saveApprovalQueue()) {
        item.status = "approved";
        delete item.decisionDate;
        renderManagerInbox();
        return;
    }
    addActivity(`published “${item.title}”.`, "Jordan Lee · Manager");
    savePublishedReview(item);
    if (item.id === activeApprovalId) {
        workflowState = "published";
        updateReviewUI();
    }
    renderManagerInbox();
}

async function importDraft(file) {
    if (!file) return;
    const extension = file.name.split(".").pop().toLowerCase();
    const textFormats = ["txt", "md", "html", "htm", "csv"];
    if (["png", "jpg", "jpeg", "webp"].includes(extension)) {
        importedAsset = file.name;
        importedMarkup = "";
        editor.textContent = `[Visual asset: ${file.name}]`;
        draftBaselineText = getDraftText();
        document.getElementById("contentType").value = "visual";
        addActivity(`selected visual asset “${file.name}” for local review.`);
        invalidateReview();
        draftNotice = "";
        document.getElementById("reviewAnnouncement").textContent = `Selected “${file.name}” as a visual asset. Run review to check it.`;
        return;
    }
    if (!textFormats.includes(extension)) {
        draftNotice = "This prototype imports TXT, MD, HTML, CSV, PNG, JPG and WEBP files only. Paste other content into the editor.";
        scanHasRun = false;
        currentFindings = [];
        updateReviewUI();
        document.getElementById("reviewAnnouncement").textContent = draftNotice;
        return;
    }

    try {
        const content = await file.text();
        if (extension === "html" || extension === "htm") {
            importedMarkup = content;
            const documentCopy = new DOMParser().parseFromString(content, "text/html");
            documentCopy.querySelectorAll("script, style, noscript").forEach((node) => node.remove());
            editor.textContent = documentCopy.body.textContent.trim();
        } else {
            importedMarkup = "";
            editor.textContent = content;
        }
        draftBaselineText = getDraftText();
        importedAsset = "";
        addActivity(`imported “${file.name}” locally.`);
        invalidateReview();
        draftNotice = "";
        document.getElementById("reviewAnnouncement").textContent = `Imported “${file.name}”. Run review to check the draft.`;
    } catch (error) {
        draftNotice = `Could not read “${file.name}”. Please try another supported file or paste the draft.`;
        scanHasRun = false;
        currentFindings = [];
        updateReviewUI();
        document.getElementById("reviewAnnouncement").textContent = draftNotice;
    }
}

document.getElementById("scanBtn").addEventListener("click", runSimulationScan);
document.getElementById("checkAgainBtn").addEventListener("click", runSimulationScan);
document.getElementById("roundBackBtn").addEventListener("click", resetToStart);
workflowActionBtn.addEventListener("click", handleWorkflowAction);
roleSelect.addEventListener("change", () => {
    if (draftNeedsSave) {
        if (draftSaveTimer) window.clearTimeout(draftSaveTimer);
        draftSaveTimer = null;
        saveDraftNow();
    }
    transitionToRole(roleSelect.value);
});
document.getElementById("contentType").addEventListener("change", loadContentTypeSample);
editor.addEventListener("input", invalidateReview);
document.getElementById("managerSearch").addEventListener("input", renderManagerInbox);
document.getElementById("managerFilter").addEventListener("change", (event) => {
    try {
        localStorage.setItem(managerFilterKey, event.target.value);
    } catch (error) {
        console.error("Could not save the manager inbox filter.", error);
    }
    renderManagerInbox();
});
issueList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-issue-id]");
    if (button) applySuggestion(button.dataset.issueId);
});
document.getElementById("draftFile").addEventListener("change", (event) => importDraft(event.target.files[0]));
document.getElementById("commentForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.getElementById("commentInput");
    const comment = input.value.trim();
    if (!comment) return;
    addActivity(`commented: “${comment}”`, roleSelect.value === "creator" ? "Alex Morgan · Creator" : roleSelect.value === "manager" ? "Jordan Lee · Manager" : "Taylor Kim · Reviewer");
    input.value = "";
});

function handleManagerActionClick(event) {
    const button = event.target.closest("[data-approval-action][data-approval-id]");
    if (!button) return;
    if (button.dataset.approvalAction === "publish") {
        handlePublishApproval(button.dataset.approvalId);
    } else {
        let rejectionReason = "";
        if (button.dataset.approvalAction === "changes") {
            const card = button.closest(".approval-card");
            const reasonInput = card.querySelector("[data-rejection-reason]");
            const error = card.querySelector(".rejection-error");
            rejectionReason = reasonInput.value.trim();
            if (!rejectionReason) {
                reasonInput.setAttribute("aria-invalid", "true");
                error.textContent = "Add a reason so the creator knows what to fix.";
                error.hidden = false;
                reasonInput.focus();
                return;
            }
        }
        handleApprovalDecision(button.dataset.approvalAction, button.dataset.approvalId, rejectionReason);
    }
}

document.getElementById("managerInbox").addEventListener("click", handleManagerActionClick);
document.getElementById("managerHistory").addEventListener("click", handleManagerActionClick);
document.getElementById("rejectionList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-rejection-action='review-again'][data-approval-id]");
    if (button) handleReviewAgain(button.dataset.approvalId);
});

window.addEventListener("hashchange", () => {
    setActiveView(getViewFromHash());
});
window.addEventListener("storage", (event) => {
    if (event.key === approvalQueueKey) {
        approvalQueue = loadApprovalQueue();
        renderManagerInbox();
        renderCreatorRejections();
        refreshPublishedContent();
    } else if (event.key === reviewHistoryKey) {
        reviewHistory = loadReviewHistory();
        renderReviewHistory();
        updateInsights();
    }
});
window.addEventListener("pagehide", () => {
    if (draftNeedsSave && draftSaveTimer) {
        window.clearTimeout(draftSaveTimer);
        draftSaveTimer = null;
    }
    if (draftNeedsSave) saveDraftNow();
});
document.getElementById("newReviewBtn").addEventListener("click", () => {
    window.location.hash = "#workspace";
    setActiveView("workspace");
    editor.focus();
});

try {
    const savedFilter = localStorage.getItem(managerFilterKey);
    if (["pending", "revised", "changes_requested"].includes(savedFilter)) {
        document.getElementById("managerFilter").value = savedFilter;
    }
} catch (error) {
    console.error("Could not restore the manager inbox filter.", error);
}
const restoredDraft = restoreSavedDraft();
addActivity(restoredDraft ? "restored the autosaved draft." : "created the example draft.");
updateWordCount();
updateReviewUI();
renderReviewHistory();
setActiveView(getViewFromHash());
