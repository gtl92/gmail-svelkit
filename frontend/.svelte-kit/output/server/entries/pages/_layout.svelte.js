import { x as head, y as slot, w as pop, u as push } from "../../chunks/index.js";
function _layout($$payload, $$props) {
  push();
  head($$payload, ($$payload2) => {
    $$payload2.out.push(`<link rel="stylesheet" href="https://cdn.metroui.org.ua/v4/css/metro-all.min.css"/> <link rel="stylesheet" href="https://cdn.metroui.org.ua/4.5.12/icons.css"/>`);
  });
  $$payload.out.push(`<!---->`);
  slot($$payload, $$props, "default", {});
  $$payload.out.push(`<!---->`);
  pop();
}
export {
  _layout as default
};
