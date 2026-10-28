let roleDeleteObserver;

const addRoleDeleteButtons = () => {
  if (!can("MANAGE_ROLES")) return;
  document.querySelectorAll(".role-row").forEach((row) => {
    if (row.querySelector(".role-delete")) return;
    const editButton = row.querySelector(".role-edit");
    const roleId = Number(editButton?.dataset.roleId);
    const role = roles.find((item) => item.id === roleId);
    if (!role || role.builtIn) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary role-delete";
    button.textContent = "Eliminar";
    button.addEventListener("click", async () => {
      if (!window.confirm(`¿Eliminar el rol «${role.name}»? Esta acción no se puede deshacer.`)) return;
      try {
        await api(`/api/v1/roles/${role.id}`, { method: "DELETE" });
        showNotice("Rol eliminado correctamente");
        await loadRoles();
      } catch (error) {
        showNotice(error.message, true);
      }
    });
    row.appendChild(button);
  });
};

roleDeleteObserver = new MutationObserver(addRoleDeleteButtons);
roleDeleteObserver.observe($("roles-list"), { childList: true, subtree: true });
addRoleDeleteButtons();
