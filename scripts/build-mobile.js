const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const outputDir = path.join(rootDir, "mobile-web");

const files = [
  "index.html",
  "app.js",
  "restaurants.js",
  "styles.css",
  "mobile.css",
  "mobile-boot.js",
  "mobile-app.js",
];

const assetFiles = [
  "background.png",
  "favicon.png",
  "logo.png",
];

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outputDir, "assets"), { recursive: true });

files.forEach((file) => {
  fs.copyFileSync(path.join(rootDir, file), path.join(outputDir, file));
});

assetFiles.forEach((file) => {
  fs.copyFileSync(path.join(rootDir, "assets", file), path.join(outputDir, "assets", file));
});

const indexPath = path.join(outputDir, "index.html");
let indexHtml = fs.readFileSync(indexPath, "utf8");
indexHtml = indexHtml
  .replace(
    "<title>ChicagoZee</title>",
    [
      '<meta name="theme-color" content="#da2929" />',
      '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
      "<title>ChicagoZee</title>",
      '<script src="mobile-boot.js"></script>',
    ].join("\n    ")
  )
  .replace(
    '<link rel="stylesheet" href="styles.css" />',
    '<link rel="stylesheet" href="styles.css" />\n    <link rel="stylesheet" href="mobile.css" />'
  )
  .replace(
    /<div class="background-media" aria-hidden="true">[\s\S]*?<\/div>\n    <header/,
    [
      '<div class="app-loading-screen" id="app-loading-screen" aria-label="Loading ChicagoZee">',
      '      <img class="app-loading-logo" src="assets/favicon.png" alt="ChicagoZee" />',
      '    </div>',
      "",
      '    <div class="background-media" aria-hidden="true">',
      '      <img class="background-image" src="assets/background.png" alt="" />',
      "    </div>",
      "    <header",
    ].join("\n")
  )
  .replace(
    "    <template id=\"restaurant-card-template\">",
    [
      '    <nav class="native-tab-bar" aria-label="App navigation">',
      '      <a class="native-tab-link" href="#home">Home</a>',
      '      <a class="native-tab-link" href="#search">Search</a>',
      '      <a class="native-tab-link" href="#map-view">Map</a>',
      '      <a class="native-tab-link" href="#suggest">Suggest</a>',
      "    </nav>",
      "",
      '    <template id="restaurant-card-template">',
    ].join("\n")
  )
  .replace(
    '<script src="app.js"></script>',
    '<script src="app.js"></script>\n    <script src="mobile-app.js"></script>'
  );
fs.writeFileSync(indexPath, indexHtml);

const appPath = path.join(outputDir, "app.js");
let appJs = fs.readFileSync(appPath, "utf8");
appJs = appJs.replace(
  "function dockSearchBarIntoFilters() {\n",
  "function dockSearchBarIntoFilters() {\n  if (document.documentElement.classList.contains(\"is-native-app\")) {\n    return;\n  }\n\n"
);
fs.writeFileSync(appPath, appJs);

console.log(`Built mobile web assets in ${outputDir}`);
