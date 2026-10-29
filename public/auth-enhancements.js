const authJson = async (url, body) => { const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || "No fue posible completar la operación"); return data; };
const resetToken = new URLSearchParams(location.search).get("reset");
const renderResetForm = () => {
  const card = document.querySelector(".login-card");
  if (!card) return;
  card.innerHTML = `<div class="brand">REVEX <span>HELPDESK</span></div><h1>Nueva contraseña</h1><p>Elige una contraseña de mínimo 10 caracteres para recuperar tu acceso.</p><form id="reset-password-form"><label>Nueva contraseña<input id="reset-password" type="password" minlength="10" required /></label><label>Confirmar contraseña<input id="reset-password-confirm" type="password" minlength="10" required /></label><button type="submit">Guardar contraseña</button><div id="reset-error" class="error"></div></form>`;
  $("reset-password-form").addEventListener("submit", async (event) => { event.preventDefault(); $("reset-error").textContent = ""; if ($("reset-password").value !== $("reset-password-confirm").value) { $("reset-error").textContent = "Las contraseñas no coinciden"; return; } try { await authJson("/api/v1/auth/reset-password", { token: resetToken, password: $("reset-password").value }); card.innerHTML = `<div class="brand">REVEX <span>HELPDESK</span></div><h1>Contraseña actualizada</h1><p>Ya puedes iniciar sesión con tu nueva contraseña.</p><button id="go-login" type="button">Ir a iniciar sesión</button>`; $("go-login").addEventListener("click", () => { location.href = "/"; }); } catch (error) { $("reset-error").textContent = error.message; } });
};
const enhanceLogin = () => {
  if (resetToken) return renderResetForm();
  const form = $("login-form");
  if (!form || document.getElementById("forgot-password-link")) return;
  const link = document.createElement("button"); link.id = "forgot-password-link"; link.type = "button"; link.className = "auth-link"; link.textContent = "¿Olvidaste tu contraseña?";
  const panel = document.createElement("div"); panel.id = "forgot-password-panel"; panel.className = "forgot-panel"; panel.hidden = true; panel.innerHTML = `<label>Correo para recuperar<input id="forgot-email" type="email" autocomplete="email" required /></label><button id="forgot-password-submit" type="button">Enviar enlace</button><div id="forgot-password-message" class="error"></div>`;
  form.insertAdjacentElement("afterend", link); link.insertAdjacentElement("afterend", panel);
  link.addEventListener("click", () => { panel.hidden = !panel.hidden; if (!panel.hidden) { $("forgot-email").value = $("login-email").value; $("forgot-email").focus(); } });
  $("forgot-password-submit").addEventListener("click", async () => { const message = $("forgot-password-message"); message.textContent = ""; try { await authJson("/api/v1/auth/forgot-password", { email: $("forgot-email").value }); message.className = "success-message"; message.textContent = "Si el correo existe, recibirás un enlace de recuperación."; } catch (error) { message.textContent = error.message; } });
};
enhanceLogin();
