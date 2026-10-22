(function () {
  "use strict";

  const WAGER = 10;
  const SUITS = ["♠", "♥", "♦", "♣"];
  const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const CARD_VALUES = { A: 11, J: 10, Q: 10, K: 10 };

  const elements = {
    banner: document.getElementById("connection-banner"),
    joinPanel: document.getElementById("join-panel"),
    joinForm: document.getElementById("join-form"),
    playerName: document.getElementById("player-name"),
    roomCode: document.getElementById("room-code"),
    joinError: document.getElementById("join-error"),
    tablePanel: document.getElementById("table-panel"),
    tableCode: document.getElementById("table-code"),
    copyCode: document.getElementById("copy-code"),
    dealerCards: document.getElementById("dealer-cards"),
    dealerScore: document.getElementById("dealer-score"),
    playerSeats: document.getElementById("player-seats"),
    gameMessage: document.getElementById("game-message"),
    tableStatus: document.getElementById("table-status"),
    startRound: document.getElementById("start-round"),
    hit: document.getElementById("hit"),
    stand: document.getElementById("stand")
  };

  let client;
  let roomId = "";
  let state = null;
  let revision = 0;
  let playerId = sessionStorage.getItem("blackjack-player-id");
  let channel = null;
  let busy = false;

  if (!playerId) {
    playerId = crypto.randomUUID();
    sessionStorage.setItem("blackjack-player-id", playerId);
  }

  elements.playerName.value = sessionStorage.getItem("blackjack-player-name") || "";

  const configured = window.BLACKJACK_SUPABASE_URL && window.BLACKJACK_SUPABASE_ANON_KEY;
  if (!configured || !window.supabase) {
    elements.banner.hidden = false;
    elements.banner.textContent = "Multiplayer is not connected yet. Add your Supabase project URL and anon key to supabase-config.js, then follow the setup steps in README.md.";
    elements.joinForm.querySelector("button").disabled = true;
  } else {
    client = window.supabase.createClient(window.BLACKJACK_SUPABASE_URL, window.BLACKJACK_SUPABASE_ANON_KEY);
  }

  elements.joinForm.addEventListener("submit", joinTable);
  elements.copyCode.addEventListener("click", copyInvite);
  elements.startRound.addEventListener("click", () => performAction(startRound));
  elements.hit.addEventListener("click", () => performAction(() => playTurn("hit")));
  elements.stand.addEventListener("click", () => performAction(() => playTurn("stand")));

  async function joinTable(event) {
    event.preventDefault();
    if (!client) return;
    setJoinError("");
    const name = elements.playerName.value.trim().slice(0, 18);
    if (!name) return;
    sessionStorage.setItem("blackjack-player-name", name);
    elements.joinForm.querySelector("button").disabled = true;

    try {
      const requestedCode = elements.roomCode.value.trim().toUpperCase();
      if (requestedCode) {
        roomId = requestedCode;
        await loadRoom();
        if (state.phase === "playing") throw new Error("That table is in the middle of a hand. Try again after the round.");
        if (!state.players.some((player) => player.id === playerId)) {
          if (state.players.length >= 6) throw new Error("That table is full. A table can have up to six players.");
          state.players.push(newPlayer(name));
          try {
            await saveRoom();
          } catch (error) {
            await loadRoom();
            if (!state.players.some((player) => player.id === playerId)) throw error;
          }
        }
      } else {
        roomId = makeRoomCode();
        state = {
          hostId: playerId,
          phase: "lobby",
          round: 0,
          currentIndex: -1,
          dealerHand: [],
          players: [newPlayer(name)]
        };
        revision = 0;
        const { error } = await client.from("blackjack_rooms").insert({ id: roomId, state, revision });
        if (error) {
          if (error.code === "23505") throw new Error("That table code was just taken. Please create your table again.");
          throw error;
        }
      }
      openTable();
    } catch (error) {
      setJoinError(error.message || "Could not join that table. Check the code and try again.");
    } finally {
      elements.joinForm.querySelector("button").disabled = false;
    }
  }

  function newPlayer(name) {
    return { id: playerId, name, chips: 100, hand: [], result: "", status: "waiting" };
  }

  function makeRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from(crypto.getRandomValues(new Uint8Array(6)), (value) => chars[value % chars.length]).join("");
  }

  async function loadRoom() {
    const { data, error } = await client.from("blackjack_rooms").select("state, revision").eq("id", roomId).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("We couldn't find that table. Check the six-character code.");
    state = data.state;
    revision = data.revision;
  }

  async function saveRoom() {
    const nextRevision = revision + 1;
    const { data, error } = await client
      .from("blackjack_rooms")
      .update({ state, revision: nextRevision, updated_at: new Date().toISOString() })
      .eq("id", roomId)
      .eq("revision", revision)
      .select("revision")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("The table changed as you joined. Please try joining again.");
    revision = data.revision;
  }

  function openTable() {
    elements.joinPanel.hidden = true;
    elements.tablePanel.hidden = false;
    elements.tableCode.textContent = roomId;
    channel = client
      .channel(`blackjack-${roomId}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "blackjack_rooms",
        filter: `id=eq.${roomId}`
      }, (payload) => {
        if (payload.new.revision > revision) {
          state = payload.new.state;
          revision = payload.new.revision;
          render();
        }
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          showMessage("Live updates disconnected. Check your connection and refresh the page.");
        }
      });
    render();
  }

  async function copyInvite() {
    const invite = new URL(`blackjack.html?room=${roomId}`, window.location.href).href;
    try {
      await navigator.clipboard.writeText(invite);
      elements.copyCode.textContent = "Invite link copied!";
      window.setTimeout(() => { elements.copyCode.textContent = "Copy invite link"; }, 1800);
    } catch {
      window.prompt("Copy this invite link:", invite);
    }
  }

  async function performAction(action) {
    if (busy) return;
    busy = true;
    render();
    try {
      const latest = await client.from("blackjack_rooms").select("state, revision").eq("id", roomId).single();
      if (latest.error) throw latest.error;
      state = latest.data.state;
      revision = latest.data.revision;
      action();
      const nextRevision = revision + 1;
      const { data, error } = await client
        .from("blackjack_rooms")
        .update({ state, revision: nextRevision, updated_at: new Date().toISOString() })
        .eq("id", roomId)
        .eq("revision", revision)
        .select("revision")
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        await loadRoom();
        showMessage("The table changed just now. Your move wasn't applied — please check the table and try again.");
      } else {
        revision = data.revision;
      }
    } catch (error) {
      if (state && roomId) {
        try {
          await loadRoom();
        } catch (reloadError) {
          console.error("Could not reload the blackjack table after an update error.", reloadError);
        }
      }
      showMessage(error.message || "Couldn't update the table. Please try again.");
    } finally {
      busy = false;
      render();
    }
  }

  function startRound() {
    if (playerId !== state.hostId || !["lobby", "settled"].includes(state.phase)) return;
    state.phase = "playing";
    state.round += 1;
    state.dealerHand = [];
    state.players = state.players.map((player) => ({
      ...player,
      hand: [],
      result: "",
      status: player.chips < WAGER ? "out" : "playing"
    }));
    if (!state.players.some((player) => player.status === "playing")) {
      state.phase = "settled";
      state.players = state.players.map((player) => ({ ...player, status: "out" }));
      showMessage("Everyone is out of chips. Create a new table to play again.");
      return;
    }

    const deck = shuffledDeck();
    for (let deal = 0; deal < 2; deal += 1) {
      for (const player of state.players) {
        if (player.status === "playing") player.hand.push(deck.pop());
      }
      state.dealerHand.push(deck.pop());
    }
    state.deck = deck;
    state.players = state.players.map((player) => {
      if (player.status !== "playing") return player;
      player.chips -= WAGER;
      if (score(player.hand) === 21) player.status = "stand";
      return player;
    });
    state.currentIndex = findNextPlayer(-1);
    if (state.currentIndex < 0) finishRound();
    else showMessage(`${state.players[state.currentIndex].name}'s turn.`);
  }

  function playTurn(move) {
    const player = state.players[state.currentIndex];
    if (!player || player.id !== playerId || player.status !== "playing") return;
    if (move === "hit") {
      player.hand.push(state.deck.pop());
      if (score(player.hand) > 21) player.status = "bust";
      else if (score(player.hand) === 21) player.status = "stand";
    } else {
      player.status = "stand";
    }
    state.currentIndex = findNextPlayer(state.currentIndex);
    if (state.currentIndex < 0) finishRound();
    else showMessage(`${state.players[state.currentIndex].name}'s turn.`);
  }

  function findNextPlayer(afterIndex) {
    for (let i = afterIndex + 1; i < state.players.length; i += 1) {
      if (state.players[i].status === "playing") return i;
    }
    return -1;
  }

  function finishRound() {
    while (score(state.dealerHand) < 17) state.dealerHand.push(state.deck.pop());
    const dealerScore = score(state.dealerHand);
    state.players = state.players.map((player) => {
      if (player.status === "out") return player;
      const playerScore = score(player.hand);
      if (player.status !== "bust" && player.hand.length === 2 && playerScore === 21) {
        if (dealerScore === 21 && state.dealerHand.length === 2) {
          player.chips += WAGER;
          return { ...player, status: "done", result: "Push — wager returned" };
        }
        player.chips += Math.floor(WAGER * 2.5);
        return { ...player, status: "done", result: "Blackjack! +15 chips" };
      }
      if (player.status === "bust") return { ...player, status: "done", result: "Bust" };
      if (dealerScore > 21 || playerScore > dealerScore) {
        player.chips += WAGER * 2;
        return { ...player, status: "done", result: "Win +10 chips" };
      }
      if (playerScore === dealerScore) {
        player.chips += WAGER;
        return { ...player, status: "done", result: "Push — wager returned" };
      }
      return { ...player, status: "done", result: "Dealer wins" };
    });
    state.phase = "settled";
    state.currentIndex = -1;
    showMessage("Hand complete. The host can deal the next one.");
  }

  function shuffledDeck() {
    const deck = SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
    for (let i = deck.length - 1; i > 0; i -= 1) {
      const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  function score(hand) {
    let total = hand.reduce((sum, card) => sum + (CARD_VALUES[card.rank] || Number(card.rank)), 0);
    let aces = hand.filter((card) => card.rank === "A").length;
    while (total > 21 && aces > 0) {
      total -= 10;
      aces -= 1;
    }
    return total;
  }

  function render() {
    if (!state) return;
    const dealerHidden = state.phase === "playing";
    renderCards(elements.dealerCards, state.dealerHand, dealerHidden);
    elements.dealerScore.textContent = state.dealerHand.length
      ? dealerHidden ? `Showing ${score([state.dealerHand[0]])}` : `Total ${score(state.dealerHand)}`
      : "";
    elements.playerSeats.replaceChildren();
    state.players.forEach((player, index) => {
      const seat = document.createElement("article");
      seat.className = `player-seat${player.id === playerId ? " own-seat" : ""}${state.phase === "playing" && index === state.currentIndex ? " active-seat" : ""}`;
      const heading = document.createElement("h3");
      heading.textContent = `${player.name}${player.id === state.hostId ? " · host" : ""}${player.id === playerId ? " · you" : ""}`;
      const chips = document.createElement("p");
      chips.className = "chip-count";
      chips.textContent = `${player.chips} chips`;
      const cards = document.createElement("div");
      cards.className = "cards";
      renderCards(cards, player.hand, false);
      const total = document.createElement("p");
      total.className = "hand-score";
      total.textContent = player.hand.length ? `Total ${score(player.hand)}${player.result ? ` · ${player.result}` : ""}` : player.status === "out" ? "Out of chips" : "Ready";
      seat.append(heading, chips, cards, total);
      elements.playerSeats.append(seat);
    });

    const isMyTurn = state.phase === "playing" && state.players[state.currentIndex]?.id === playerId;
    elements.startRound.hidden = !(playerId === state.hostId && ["lobby", "settled"].includes(state.phase));
    elements.startRound.disabled = busy || !state.players.some((player) => player.chips >= WAGER);
    elements.hit.hidden = !isMyTurn;
    elements.stand.hidden = !isMyTurn;
    elements.hit.disabled = busy;
    elements.stand.disabled = busy;
    elements.tableStatus.textContent = state.phase === "lobby"
      ? `${state.players.length}/6 players · waiting for the host to deal`
      : state.phase === "playing"
        ? `${state.players.length} players · hand ${state.round}`
        : `Hand ${state.round} complete · ${state.players.length} players`;
  }

  function renderCards(container, hand, hideHoleCard) {
    container.replaceChildren();
    hand.forEach((card, index) => {
      const item = document.createElement("span");
      item.className = "playing-card";
      if (hideHoleCard && index === 1) {
        item.classList.add("card-back");
        item.textContent = "★";
        item.setAttribute("aria-label", "Hidden card");
      } else {
        item.classList.toggle("red-card", card.suit === "♥" || card.suit === "♦");
        item.textContent = `${card.rank}${card.suit}`;
        item.setAttribute("aria-label", `${card.rank} ${card.suit}`);
      }
      container.append(item);
    });
  }

  function showMessage(message) {
    elements.gameMessage.textContent = message;
  }

  function setJoinError(message) {
    elements.joinError.textContent = message;
    elements.joinError.hidden = !message;
  }

  const queryRoom = new URLSearchParams(window.location.search).get("room");
  if (queryRoom && /^[A-Za-z0-9]{6}$/.test(queryRoom)) {
    elements.roomCode.value = queryRoom.toUpperCase();
  }
})();
