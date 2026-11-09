(() => {
  const get = id => document.getElementById(id);
  const name = get("profile-name");
  const color = get("profile-color");
  const file = get("profile-avatar");
  const preview = get("avatar-preview");
  const status = get("profile-status");
  let avatar = "";

  function paint() {
    preview.replaceChildren();
    preview.style.color = color.value;
    if (avatar) {
      const img = document.createElement("img");
      img.src = avatar;
      img.alt = "";
      preview.append(img);
    } else {
      preview.textContent = [...name.value.trim()][0]?.toUpperCase() || "P";
    }
  }

  name.oninput = color.oninput = paint;
  get("remove-avatar").onclick = () => {
    avatar = "";
    file.value = "";
    paint();
  };

  file.onchange = async () => {
    const image = file.files[0];
    if (!image) return;
    const save = get("save-profile");
    save.disabled = true;
    file.disabled = true;
    get("remove-avatar").disabled = true;
    try {
      if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(image.type) ||
          image.size > 12 * 1024 * 1024) {
        throw new Error("Choose a PNG, JPEG, WebP, or GIF under 12 MB.");
      }
      const bitmap = await createImageBitmap(image);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 64;
        const side = Math.min(bitmap.width, bitmap.height);
        canvas.getContext("2d").drawImage(bitmap, (bitmap.width - side) / 2,
          (bitmap.height - side) / 2, side, side, 0, 0, 64, 64);
        const encoded = canvas.toDataURL("image/webp", 0.78);
        if (!encoded.startsWith("data:image/webp;base64,") || encoded.length > 14_000) {
          throw new Error("This image could not be resized. Try a different file.");
        }
        avatar = encoded;
        paint();
        status.textContent = "Image ready. Save your profile to keep it.";
      } finally {
        bitmap.close();
      }
    } catch (error) {
      status.textContent = error.message || "Could not read this image.";
    } finally {
      save.disabled = false;
      file.disabled = false;
      get("remove-avatar").disabled = false;
    }
  };

  get("profile-form").onsubmit = async event => {
    event.preventDefault();
    try {
      const response = await chrome.runtime.sendMessage({
        type: "pegparty-profile", profile: { name: name.value.trim(), color: color.value, avatar }
      });
      if (!response?.ok) throw new Error(response?.error || "Could not save your profile.");
      status.textContent = "Profile saved in this browser.";
    } catch (error) {
      status.textContent = error.message;
    }
  };

  chrome.storage.local.get("profile").then(({ profile }) => {
    if (!profile) return;
    name.value = profile.name;
    color.value = profile.color;
    avatar = profile.avatar;
    paint();
  }).catch(error => { status.textContent = error.message; });
})();
