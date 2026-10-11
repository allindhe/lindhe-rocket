document.addEventListener("DOMContentLoaded", () => {
  const card = document.querySelector(".scorecard-shell");
  if (!card) return;

  const accessPanel = card.querySelector("#access-panel");
  const accessForm = card.querySelector("#access-form");
  const accessCodeInput = card.querySelector("#access-code");
  const accessMessage = card.querySelector("#access-message");
  const accessButton = accessForm.querySelector("button[type='submit']");
  const roundPanel = card.querySelector("#round-panel");
  const roundStatus = card.querySelector("#round-status");
  const connectionLabel = card.querySelector("#connection-label");
  const players = [...card.querySelectorAll(".player-name input")].map((input) => ({
    id: input.dataset.entityId,
    name: input.value,
    scores: {},
  }));
  const holes = [...card.querySelectorAll(".hole-row")].map((row) => ({
    id: row.dataset.holeId,
    par: Number(card.querySelector(`[data-entity-id="${row.dataset.holeId}"][data-field="par"]`).value),
  }));
  const round = {
    id: card.dataset.roundId,
    players,
    holes,
  };

  function showAccess(message = "") {
    accessMessage.textContent = message;
    accessPanel.hidden = false;
    roundPanel.hidden = true;
  }

  function hydrate(snapshot) {
    round.id = snapshot.roundId;
    card.querySelector('[data-field="courseName"]').value = snapshot.courseName;

    snapshot.players.forEach((savedPlayer) => {
      const player = players.find((item) => item.id === savedPlayer.id);
      if (!player) return;
      player.name = savedPlayer.name;
      player.scores = { ...savedPlayer.scores };
      card.querySelector(`[data-entity-id="${player.id}"][data-field="name"]`).value = player.name;
    });

    snapshot.holes.forEach((savedHole) => {
      const hole = holes.find((item) => item.id === savedHole.id);
      if (!hole) return;
      hole.par = savedHole.par;
      card.querySelector(`[data-entity-id="${hole.id}"][data-field="par"]`).value = String(hole.par);
    });

    card.querySelectorAll(".stroke-input").forEach((input) => {
      const player = players.find((item) => item.id === input.dataset.playerId);
      input.value = player?.scores[input.dataset.holeId] ?? "";
    });
    updateTotals();
  }

  async function loadScorecard() {
    const response = await fetch("/api/scorecard", { credentials: "same-origin" });
    if (response.status === 401) {
      showAccess();
      return false;
    }
    if (!response.ok) throw new Error("Scorecard could not be loaded.");

    hydrate(await response.json());
    accessPanel.hidden = true;
    roundPanel.hidden = false;
    connectionLabel.textContent = "Shared round";
    roundStatus.textContent = "Changes save as you edit.";
    return true;
  }

  async function saveField(update) {
    try {
      const response = await fetch("/api/scorecard/field", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      if (response.status === 401) {
        showAccess("Your access has expired. Enter the group code again.");
        return;
      }
      if (!response.ok) throw new Error("The server rejected this change.");
      await loadScorecard();
      roundStatus.textContent = "Change saved and shared card reloaded.";
    } catch {
      roundStatus.textContent = "Could not confirm this save. Reload to check the shared value.";
    }
  }

  function emitFieldUpdate(input, value) {
    const detail = {
      roundId: round.id,
      entityType: input.dataset.entityType,
      entityId: input.dataset.entityId,
      field: input.dataset.field,
      value,
    };
    if (input.dataset.playerId) detail.playerId = input.dataset.playerId;
    if (input.dataset.holeId) detail.holeId = input.dataset.holeId;
    card.dispatchEvent(new CustomEvent("scorecard:field-update", { bubbles: true, detail }));
  }

  function formatToPar(value) {
    if (value === 0) return "E";
    return value > 0 ? `+${value}` : String(value);
  }

  function updateTotals() {
    players.forEach((player) => {
      const playedHoleIds = Object.keys(player.scores).filter((holeId) => player.scores[holeId] !== null);
      const strokes = playedHoleIds.reduce((sum, holeId) => sum + player.scores[holeId], 0);
      const playedPar = playedHoleIds.reduce((sum, holeId) => {
        const hole = holes.find((item) => item.id === holeId);
        return sum + (hole ? hole.par : 0);
      }, 0);
      const total = card.querySelector(`[data-total-for="${player.id}"]`);
      const toPar = card.querySelector(`[data-to-par-for="${player.id}"]`);
      total.textContent = playedHoleIds.length ? String(strokes) : "–";
      toPar.textContent = playedHoleIds.length ? formatToPar(strokes - playedPar) : "–";
      toPar.classList.toggle("under-par", playedHoleIds.length > 0 && strokes < playedPar);
      toPar.classList.toggle("over-par", playedHoleIds.length > 0 && strokes > playedPar);
    });
  }

  function syncModel(input) {
    if (!input.validity.valid) {
      input.setAttribute("aria-invalid", "true");
      if (input.dataset.field === "strokes") {
        const player = players.find((item) => item.id === input.dataset.playerId);
        if (player) delete player.scores[input.dataset.holeId];
        updateTotals();
      }
      return undefined;
    }
    input.removeAttribute("aria-invalid");

    if (input.dataset.field === "strokes") {
      const player = players.find((item) => item.id === input.dataset.playerId);
      const value = input.value === "" ? null : Number(input.value);
      if (player) {
        if (value === null) delete player.scores[input.dataset.holeId];
        else player.scores[input.dataset.holeId] = value;
      }
      updateTotals();
      return value;
    }

    if (input.dataset.field === "par") {
      const hole = holes.find((item) => item.id === input.dataset.entityId);
      if (hole && input.value !== "") hole.par = Number(input.value);
      updateTotals();
      return input.value === "" ? null : Number(input.value);
    }

    if (input.dataset.field === "name") {
      const player = players.find((item) => item.id === input.dataset.entityId);
      if (player) player.name = input.value;
    }
    return input.value;
  }

  card.addEventListener("input", (event) => {
    if (event.target.matches("input[data-field]")) syncModel(event.target);
  });

  card.addEventListener("change", (event) => {
    const input = event.target;
    if (!input.matches("input[data-field]")) return;
    const value = syncModel(input);
    if (value !== undefined) emitFieldUpdate(input, value);
  });

  card.addEventListener("scorecard:field-update", (event) => saveField(event.detail));

  accessForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    accessButton.disabled = true;
    accessMessage.textContent = "Checking code…";
    try {
      const response = await fetch("/api/access", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: accessCodeInput.value }),
      });
      if (response.status === 401) {
        accessMessage.textContent = "That code did not match. Try again.";
        return;
      }
      if (!response.ok) throw new Error("Access could not be checked.");
      accessCodeInput.value = "";
      await loadScorecard();
    } catch {
      accessMessage.textContent = "Could not reach the shared scorecard. Try again shortly.";
    } finally {
      accessButton.disabled = false;
    }
  });

  const clearDialog = card.querySelector("#clear-dialog");
  const clearForm = card.querySelector("#clear-form");
  const clearCode = card.querySelector("#clear-code");
  const clearMessage = card.querySelector("#clear-message");
  const clearSubmit = clearForm.querySelector("button[type='submit']");

  card.querySelector("#clear-scores").addEventListener("click", () => {
    clearCode.value = "";
    clearMessage.textContent = "";
    clearDialog.showModal();
    clearCode.focus();
  });

  card.querySelector("#cancel-clear").addEventListener("click", () => clearDialog.close());

  clearForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearSubmit.disabled = true;
    clearMessage.textContent = "Verifying code and clearing scores…";
    try {
      const response = await fetch("/api/scorecard/clear", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: clearCode.value }),
      });
      if (response.status === 401) {
        clearMessage.textContent = "Code not accepted. No scores were cleared.";
        clearCode.select();
        return;
      }
      if (!response.ok) throw new Error("The scores could not be cleared.");
      clearDialog.close();
      await loadScorecard();
      roundStatus.textContent = "Scores cleared and shared card reloaded.";
    } catch {
      clearMessage.textContent = "Could not clear scores. Try again shortly.";
    } finally {
      clearSubmit.disabled = false;
    }
  });

  updateTotals();
  loadScorecard().catch(() => showAccess("Could not reach the shared scorecard. Try again shortly."));
});

