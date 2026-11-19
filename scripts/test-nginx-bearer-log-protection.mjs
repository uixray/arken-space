import console from "node:console";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const files = [
  "infra/nginx/container.conf",
  "infra/nginx/arken-khar.space.conf",
  "infra/nginx/arken.uixray.tech.conf",
  "infra/nginx/e2e-edge.conf",
];
const marker = /location\s+~\*\s+\^\/\(\?:gm\|join\)\(\?:\/\|\$\)\s*\{/g;

function locationBlocks(source, file) {
  const blocks = [];
  for (const match of source.matchAll(marker)) {
    let depth = 1;
    let end = match.index + match[0].length;
    while (end < source.length && depth > 0) {
      if (source[end] === "{") depth += 1;
      if (source[end] === "}") depth -= 1;
      end += 1;
    }
    assert.equal(depth, 0, `${file}: protected location has unbalanced braces`);
    blocks.push(source.slice(match.index, end));
  }
  return blocks;
}

const counts = new Map();
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const blocks = locationBlocks(source, file);
  assert.ok(blocks.length > 0, `${file}: no protected campaign-link location`);
  assert.match(
    source,
    /map\s+\$request_uri\s+\$arken_[\w]+_uri_loggable\s*\{/,
    `${file}: raw request-target logging guard is required`,
  );
  assert.match(
    source,
    /access_log\s+\/var\/log\/nginx\/access\.log\s+main\s+if=\$arken_[\w]+_uri_loggable\s*;/,
    `${file}: keep normal observability while conditionally omitting bearer paths`,
  );
  assert.match(
    source,
    /%67\).*%6d/s,
    `${file}: guard percent-encoded GM path prefix`,
  );
  assert.match(
    source,
    /%6a\).*%6f\).*%69\).*%6e/s,
    `${file}: guard percent-encoded join path prefix`,
  );
  assert.match(
    source,
    /%2f\)\+/i,
    `${file}: raw guard must cover repeated and encoded leading separators`,
  );
  if (!/arken\.uixray\.tech\.conf$/.test(file)) {
    assert.match(
      source,
      /if\s*\(\$arken_[\w]+_uri_loggable\s*=\s*0\)\s*\{\s*rewrite\s+\^\s+\/__arken_sensitive_index\??\s+last;/,
      `${file}: raw-target guard must run before normalized location matching`,
    );
    if (/e2e-edge\.conf$/.test(file) || /arken-khar\.space\.conf$/.test(file))
      assert.match(
        source,
        /rewrite\s+\^\s+\/__arken_sensitive_index\?\s+last;/,
        `${file}: clear bearer-like query args before proxying to the SPA`,
      );
    const internal = source.match(
      /location\s+=\s+\/__arken_sensitive_index\s*\{([\s\S]*?)\n\s*\}/,
    );
    assert.ok(
      internal,
      `${file}: sensitive requests need a private internal target`,
    );
    assert.match(
      internal[1],
      /internal\s*;/,
      `${file}: internal target must reject direct requests`,
    );
    assert.match(
      internal[1],
      /access_log\s+off\s*;/,
      `${file}: internal target must not log raw request target`,
    );
    assert.match(
      internal[1],
      /error_log\s+\/dev\/null\s+emerg\s*;/,
      `${file}: internal target must suppress route errors`,
    );
    assert.match(
      internal[1],
      /add_header\s+Referrer-Policy\s+no-referrer\s+always\s*;/,
      `${file}: internal target needs no-referrer`,
    );
    if (/e2e-edge\.conf$/.test(file))
      assert.match(
        internal[1],
        /proxy_pass\s+http:\/\/web:80\//,
        `${file}: sensitive rewrite must proxy the SPA entry`,
      );
    if (/arken-khar\.space\.conf$/.test(file))
      assert.match(
        internal[1],
        /proxy_pass\s+http:\/\/127\.0\.0\.1:4180\//,
        `${file}: sensitive rewrite must proxy the SPA entry`,
      );
  }
  for (const block of blocks) {
    assert.match(
      block,
      /access_log\s+off\s*;/,
      `${file}: URI access logging must be disabled`,
    );
    assert.match(
      block,
      /error_log\s+\/dev\/null\s+emerg\s*;/,
      `${file}: URI-bearing errors must not reach error logs`,
    );
    assert.match(
      block,
      /add_header\s+Referrer-Policy\s+no-referrer\s+always\s*;/,
      `${file}: sensitive route needs no-referrer`,
    );
    if (
      /container\.conf$/.test(file) ||
      (/arken-khar\.space\.conf$/.test(file) && block.includes("try_files"))
    ) {
      assert.match(
        block,
        /try_files\s+\/index\.html\s+=404\s*;/,
        `${file}: serve the SPA without a URI-changing internal redirect`,
      );
      assert.doesNotMatch(
        block,
        /rewrite\s+/,
        `${file}: avoid a URI-changing internal redirect in protected location`,
      );
    }
  }
  counts.set(file, blocks.length);
}

const khar = readFileSync("infra/nginx/arken-khar.space.conf", "utf8");
const oldDomain = readFileSync("infra/nginx/arken.uixray.tech.conf", "utf8");
assert.match(
  khar,
  /add_header\s+Referrer-Policy\s+no-referrer\s+always\s*;/,
  "public canonical host should not send referrers",
);
assert.match(
  oldDomain,
  /return\s+301\s+https:\/\/arken-khar\.space\$request_uri\s*;/,
  "legacy host must preserve old direct-link URL for redirect",
);
assert.match(
  khar,
  /return\s+301\s+https:\/\/\$host\$request_uri\s*;/,
  "HTTP upgrade must preserve legacy direct-link URL",
);

// The Docker legacy overlay deliberately suppresses ALL retired-host request
// logging, rather than borrowing a native install's URI-bearing `main` format.
const edgeLegacy = readFileSync(
  "infra/nginx/arken-legacy-edge.conf",
  "utf8",
).replaceAll("\r\n", "\n");
assert.doesNotMatch(
  edgeLegacy,
  /default_server|proxy_pass|access_log\s+(?!off;)/,
);
assert.equal(
  (edgeLegacy.match(/server_name arken\.uixray\.tech;/g) ?? []).length,
  2,
);
for (const protocol of ["HTTP", "HTTPS"]) {
  const block = edgeLegacy
    .split(`# BEGIN LEGACY ${protocol}\n`)[1]
    ?.split(`# END LEGACY ${protocol}`)[0];
  assert.ok(
    block,
    `Docker legacy ${protocol} block must be separately stageable`,
  );
  assert.match(block, /access_log\s+off;/);
  assert.match(block, /error_log\s+\/dev\/null\s+emerg;/);
  assert.match(block, /add_header\s+Referrer-Policy\s+no-referrer\s+always;/);
  assert.match(
    block,
    /return\s+301\s+https:\/\/arken-khar\.space\$request_uri\s*;/,
  );
}
assert.match(edgeLegacy, /listen\s+443\s+ssl;/);
assert.match(
  edgeLegacy,
  /ssl_certificate\s+\/etc\/letsencrypt\/live\/arken\.uixray\.tech\/fullchain\.pem;/,
);
assert.match(edgeLegacy, /ssl_protocols\s+TLSv1\.2\s+TLSv1\.3;/);
assert.match(edgeLegacy, /location\s+\^~\s+\/\.well-known\/acme-challenge\//);
assert.match(edgeLegacy, /try_files\s+\$uri\s+=404;/);

console.log(
  `Nginx bearer-log protection source checks passed (${[...counts.values()].reduce((a, b) => a + b, 0)} guarded locations across ${files.length} configs; Docker legacy overlay suppresses both host logs).`,
);
