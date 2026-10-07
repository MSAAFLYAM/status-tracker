/* Photo: read a file, resize so the longest side is 240px, return a JPEG data URL.
 * Prototype behaviour kept (photos live inside the record => backup includes them). */

export const readPhoto = (f) =>
  new Promise((ok) => {
    if (!f) return ok(null);
    const r = new FileReader();
    r.onload = () => {
      const i = new Image();
      i.onload = () => {
        const k = Math.min(1, 240 / Math.max(i.width, i.height));
        const c = document.createElement("canvas");
        c.width = Math.round(i.width * k);
        c.height = Math.round(i.height * k);
        c.getContext("2d").drawImage(i, 0, 0, c.width, c.height);
        ok(c.toDataURL("image/jpeg", 0.7));
      };
      i.onerror = () => ok(null);
      i.src = r.result;
    };
    r.onerror = () => ok(null);
    r.readAsDataURL(f);
  });
