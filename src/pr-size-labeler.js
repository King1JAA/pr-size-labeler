#!/usr/bin/env node
/**
 * pr-size-labeler / src/pr-size-labeler.js
 * Labels a pull request XS/S/M/L/XL based on lines changed, and warns on oversized PRs.
 * Uses the gh CLI, so it works without any API token wiring.
 *
 * Usage:
 *   node src/pr-size-labeler.js --pr 42
 *   node src/pr-size-labeler.js --pr 42 --comment
 *   node src/pr-size-labeler.js --pr 42 --thresholds 10,50,200,500
 */
'use strict';

const { execSync } = require('child_process');

const DEFAULT_THRESHOLDS = { XS: 10, S: 50, M: 200, L: 500 }; // above L = XL

function sh(cmd) {
  return execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
}

function parseArgs(argv) {
  const args = { pr: null, comment: false, thresholds: DEFAULT_THRESHOLDS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pr') args.pr = argv[++i];
    else if (a === '--comment') args.comment = true;
    else if (a === '--thresholds') {
      const [xs, s, m, l] = argv[++i].split(',').map(Number);
      args.thresholds = { XS: xs, S: s, M: m, L: l };
    } else if (a === '--help') args.help = true;
  }
  return args;
}

function classify(linesChanged, t) {
  if (linesChanged <= t.XS) return 'XS';
  if (linesChanged <= t.S) return 'S';
  if (linesChanged <= t.M) return 'M';
  if (linesChanged <= t.L) return 'L';
  return 'XL';
}

const LABEL_COLORS = {
  XS: 'C5DEF5',
  S: '7FDBAA',
  M: 'F9D849',
  L: 'F5A25D',
  XL: 'F16C6C',
};

function ensureLabel(size) {
  const name = `size/${size}`;
  try {
    sh(`gh label create "${name}" --color ${LABEL_COLORS[size]} --force`);
  } catch (e) {
    // label may already exist under a protected color scheme — non-fatal
  }
  return name;
}

function printHelp() {
  console.log(`pr-size-labeler — label PRs by size and warn on oversized ones

Usage:
  pr-size-labeler --pr 42                        Compute size, apply label
  pr-size-labeler --pr 42 --comment               Also post a size-summary comment
  pr-size-labeler --pr 42 --thresholds 10,50,200,500   Custom XS/S/M/L cutoffs`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.pr) {
    printHelp();
    if (!args.pr && !args.help) process.exit(1);
    return;
  }

  let authOk = true;
  try {
    sh('gh auth status');
  } catch (e) {
    authOk = false;
  }
  if (!authOk) {
    console.error('✗ GitHub CLI is not authenticated. Fix it with: gh auth login');
    process.exit(1);
  }

  let repo;
  try {
    repo = sh('gh repo view --json nameWithOwner -q .nameWithOwner');
  } catch (e) {
    console.error('✗ Could not auto-detect the repo. Run this from inside a cloned GitHub repo.');
    process.exit(1);
  }

  const statsJson = sh(`gh pr view ${args.pr} --repo ${repo} --json additions,deletions,title`);
  const { additions, deletions, title } = JSON.parse(statsJson);
  const totalChanged = additions + deletions;
  const size = classify(totalChanged, args.thresholds);
  const labelName = ensureLabel(size);

  // remove any other size/* labels first, then apply the right one
  try {
    const current = JSON.parse(sh(`gh pr view ${args.pr} --repo ${repo} --json labels`)).labels;
    current
      .filter((l) => l.name.startsWith('size/') && l.name !== labelName)
      .forEach((l) => {
        try { sh(`gh pr edit ${args.pr} --repo ${repo} --remove-label "${l.name}"`); } catch (e) {}
      });
  } catch (e) {}

  sh(`gh pr edit ${args.pr} --repo ${repo} --add-label "${labelName}"`);
  console.log(`✓ PR #${args.pr} ("${title}") labeled ${labelName} (+${additions}/-${deletions}, ${totalChanged} total)`);

  const isOversized = size === 'XL';
  if (isOversized) {
    console.warn(`⚠ PR #${args.pr} is oversized (${totalChanged} lines). Consider splitting it up.`);
  }

  if (args.comment) {
    const body = isOversized
      ? `**Size: ${size}** — ${totalChanged} lines changed (+${additions}/-${deletions}).\n\n⚠ This PR is quite large. Smaller PRs are easier and faster to review — consider splitting it if possible.`
      : `**Size: ${size}** — ${totalChanged} lines changed (+${additions}/-${deletions}).`;
    sh(`gh pr comment ${args.pr} --repo ${repo} --body ${JSON.stringify(body)}`);
    console.log('✓ Posted size comment');
  }
}

main();
