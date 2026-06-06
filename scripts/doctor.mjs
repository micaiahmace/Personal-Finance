#!/usr/bin/env node

const appUrl = normalizeUrl(process.env.FINANCE_APP_URL ?? "http://127.0.0.1:3000");

try {
  const htmlResponse = await fetch(appUrl, { cache: "no-store" });

  if (!htmlResponse.ok) {
    throw new Error(`App returned ${htmlResponse.status} for ${appUrl}`);
  }

  const html = await htmlResponse.text();
  const assetUrls = getNextAssetUrls(html, appUrl);

  if (assetUrls.length === 0) {
    throw new Error("No Next static assets were found in the page HTML.");
  }

  const failedAssets = [];

  await Promise.all(
    assetUrls.map(async (assetUrl) => {
      const assetResponse = await fetch(assetUrl, { cache: "no-store" });

      if (!assetResponse.ok) {
        failedAssets.push(`${assetResponse.status} ${assetUrl}`);
      }
    })
  );

  if (failedAssets.length > 0) {
    throw new Error(`Some Next assets did not load:\n${failedAssets.join("\n")}`);
  }

  console.log(`Finance app doctor OK: ${assetUrls.length} Next assets returned 200 from ${appUrl}`);
} catch (error) {
  console.error("Finance app doctor failed.");
  console.error(error instanceof Error ? error.message : error);
  console.error("If the page is open but clicks do nothing, stop the dev server and restart it with npm run dev.");
  process.exit(1);
}

function getNextAssetUrls(html, baseUrl) {
  const matches = html.matchAll(/\s(?:src|href)="([^"]*\/_next\/static\/[^"]+\.(?:js|css)(?:\?[^"]*)?)"/g);
  const urls = [];

  for (const match of matches) {
    const assetPath = match[1].replaceAll("&amp;", "&");
    const assetUrl = new URL(assetPath, baseUrl).toString();

    if (!urls.includes(assetUrl)) {
      urls.push(assetUrl);
    }
  }

  return urls;
}

function normalizeUrl(value) {
  return value.endsWith("/") ? value : `${value}/`;
}
