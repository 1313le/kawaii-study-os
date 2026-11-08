/* =========================================================
   kawaii / STUDY OS — author gate
   The site stays readable for everyone; this dialog unlocks the
   write paths (desk save, taxonomy, assets, resources).
   ========================================================= */

(function () {
  "use strict";

  let status = { enabled: true, configured: false, authed: false, needsSetupCode: false };
  let dialog = null;
  let chip = null;
  let challenge = null;
  let pending = [];
  let busy = false;
  let readyResolve = null;
  const ready = new Promise((resolve) => {
    readyResolve = resolve;
  });

  const q = (selector) => (dialog ? dialog.querySelector(selector) : document.querySelector(selector));

  async function fetchStatus() {
    try {
      const response = await fetch("/api/auth/status", { cache: "no-store" });
      if (!response.ok) throw new Error("status");
      status = await response.json();
    } catch (error) {
      // A static host has no write API at all; the gate stays out of the way.
      status = { enabled: false, configured: false, authed: true, needsSetupCode: false, offline: true };
    }
    return status;
  }

  async function fetchChallenge() {
    try {
      const response = await fetch("/api/auth/challenge", { cache: "no-store" });
      if (!response.ok) throw new Error("challenge");
      challenge = await response.json();
    } catch (error) {
      challenge = null;
    }
  }

  function setError(text) {
    const node = q("[data-auth-error]");
    if (!node) return;
    node.hidden = !text;
    node.textContent = text || "";
  }

  function setChallenge() {
    const question = q("[data-auth-question]");
    if (question && challenge) question.textContent = challenge.question;
  }

  function build() {
    dialog = document.createElement("dialog");
    dialog.className = "auth";
    dialog.id = "kawaii-auth";
    dialog.setAttribute("aria-labelledby", "auth-title");
    dialog.innerHTML = `<form class="auth__frame" data-auth-form>
  <header class="auth__head">
    <div>
      <span class="auth__tag">AUTHOR / 作者入口</span>
      <h2 class="auth__title" id="auth-title" data-auth-title>作者登录</h2>
    </div>
    <button class="auth__close" type="button" data-auth-close aria-label="关闭">×</button>
  </header>
  <p class="auth__note" data-auth-note></p>
  <div class="auth__body">
    <label class="auth__field">作者密码
      <input type="password" data-auth-password autocomplete="current-password" placeholder="至少 8 位">
    </label>
    <label class="auth__field" data-auth-confirm-wrap hidden>再输一次
      <input type="password" data-auth-confirm autocomplete="new-password" placeholder="确认密码">
    </label>
    <label class="auth__field" data-auth-code-wrap hidden>服务端设置码
      <input type="text" data-auth-setup-code inputmode="numeric" placeholder="终端里打印的 6 位数字">
    </label>
    <div class="auth__challenge" data-auth-challenge-wrap hidden>
      <span class="auth__question" data-auth-question>— + — = ?</span>
      <input type="text" data-auth-answer inputmode="numeric" placeholder="答案">
      <button class="auth__refresh" type="button" data-auth-refresh title="换一题" aria-label="换一题">↻</button>
    </div>
    <p class="auth__error" data-auth-error role="alert" hidden></p>
  </div>
  <footer class="auth__foot">
    <button class="btn btn--primary" type="submit" data-auth-submit>登录</button>
    <button class="btn btn--ghost" type="button" data-auth-cancel>稍后</button>
  </footer>
</form>`;
    document.body.appendChild(dialog);

    dialog.querySelector("[data-auth-close]").addEventListener("click", () => close(false));
    dialog.querySelector("[data-auth-cancel]").addEventListener("click", () => close(false));
    dialog.querySelector("[data-auth-refresh]").addEventListener("click", async () => {
      await fetchChallenge();
      setChallenge();
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) close(false);
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close(false);
    });
    dialog.addEventListener("close", () => {
      if (pending.length) settle(false);
    });
    dialog.querySelector("[data-auth-form]").addEventListener("submit", submit);
  }

  function renderState() {
    const setup = !status.configured;
    const confirmWrap = q("[data-auth-confirm-wrap]");
    const codeWrap = q("[data-auth-code-wrap]");
    const challengeWrap = q("[data-auth-challenge-wrap]");
    const submit = q("[data-auth-submit]");
    const title = q("[data-auth-title]");
    const note = q("[data-auth-note]");
    if (confirmWrap) confirmWrap.hidden = !setup;
    if (codeWrap) codeWrap.hidden = !(setup && status.needsSetupCode);
    if (challengeWrap) challengeWrap.hidden = setup;
    if (submit) submit.textContent = setup ? "设置密码" : "登录";
    if (title) title.textContent = setup ? "设置作者密码" : "作者登录";
    if (note) {
      note.textContent = setup
        ? "这台站点只允许作者写文章。先设置一个至少 8 位的密码；访客只能阅读。忘记密码时删除 data/auth.json 后重启即可重设。"
        : "访客只能阅读；写文章、改分类、上传素材与资源都需要作者密码。";
    }
    const password = q("[data-auth-password]");
    if (password) password.value = "";
    const confirm = q("[data-auth-confirm]");
    if (confirm) confirm.value = "";
    const answer = q("[data-auth-answer]");
    if (answer) answer.value = "";
    setError("");
    setChallenge();
    window.setTimeout(() => password && password.focus(), 40);
  }

  async function open() {
    if (!status.enabled) return true;
    if (status.authed) return true;
    if (!dialog) build();
    if (status.configured && !challenge) await fetchChallenge();
    renderState();
    if (!dialog.open) dialog.showModal();
    return new Promise((resolve) => {
      pending.push(resolve);
    });
  }

  function settle(ok) {
    const list = pending;
    pending = [];
    list.forEach((resolve) => resolve(Boolean(ok)));
  }

  function close(ok) {
    if (dialog && dialog.open) dialog.close();
    settle(ok);
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    const setup = !status.configured;
    const password = q("[data-auth-password]").value;
    const confirm = q("[data-auth-confirm]").value;
    const answer = q("[data-auth-answer]").value;
    const setupCode = q("[data-auth-setup-code]") ? q("[data-auth-setup-code]").value : "";
    try {
      const payload = setup
        ? { password, confirm, setupCode }
        : { password, challengeId: challenge ? challenge.id : "", answer };
      const response = await fetch(setup ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.error || "操作失败");
        error.code = data.code;
        throw error;
      }
      status = { ...status, configured: true, authed: true };
      challenge = null;
      updateChip();
      document.dispatchEvent(new CustomEvent("kawaii:auth", { detail: { authed: true, configured: true } }));
      close(true);
    } catch (error) {
      setError(error.message);
      if (error.code === "setup") {
        status = { ...status, configured: false };
        renderState();
      } else if (!setup) {
        challenge = null;
        await fetchChallenge();
        setChallenge();
        const answerInput = q("[data-auth-answer]");
        if (answerInput) answerInput.value = "";
      }
    } finally {
      busy = false;
    }
  }

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (error) {
      /* the local state still locks the UI */
    }
    status = { ...status, authed: false };
    updateChip();
    document.dispatchEvent(new CustomEvent("kawaii:auth", { detail: { authed: false } }));
    if (document.body.hasAttribute("data-requires-auth")) open();
  }

  function updateChip() {
    const authorMode = status.enabled ? status.authed : !status.offline;
    document.body.dataset.authed = authorMode ? "true" : "false";
    if (!status.enabled || status.offline) {
      if (chip) chip.remove();
      chip = null;
      return;
    }
    if (!chip) {
      chip = document.createElement("button");
      chip.type = "button";
      chip.className = "auth-chip";
      chip.setAttribute("data-auth-chip", "");
      chip.addEventListener("click", () => {
        if (status.authed) {
          if (chip.dataset.armed === "1") {
            chip.dataset.armed = "0";
            logout();
          } else {
            chip.dataset.armed = "1";
            chip.textContent = "AUTHOR · 确认退出";
            window.setTimeout(() => {
              if (!chip) return;
              chip.dataset.armed = "0";
              chip.textContent = "AUTHOR · 已登录";
            }, 2600);
          }
          return;
        }
        open();
      });
      document.body.appendChild(chip);
    }
    chip.hidden = false;
    chip.dataset.authed = status.authed ? "true" : "false";
    chip.textContent = status.authed ? "AUTHOR · 已登录" : "AUTHOR · 登录";
  }

  function requireAuth() {
    if (!status.enabled) return Promise.resolve(true);
    if (status.authed) return Promise.resolve(true);
    return open();
  }

  window.KawaiiAuth = {
    ready() {
      return ready;
    },
    status() {
      return status;
    },
    require: requireAuth,
    open,
    logout
  };

  (async () => {
    await fetchStatus();
    updateChip();
    if (document.body.hasAttribute("data-requires-auth") && status.enabled && !status.authed) {
      open();
    }
    readyResolve(status);
  })();
})();
