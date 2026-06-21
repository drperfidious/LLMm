/**
 * Summarize an iOS fit benchmark report and print baseline promotions.
 *
 *   yarn summarize:ios-fit-report --input /path/to/benchmark-report.json
 *   yarn summarize:ios-fit-report --input report.json --out summary.md
 */

import * as fs from 'fs';

import {
  renderIosFitSummaryMarkdown,
  summarizeIosFitReport,
} from '../helpers/ios-fit-summary';

interface Args {
  input?: string;
  out?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input') {
      args.input = argv[++i];
    } else if (arg === '--out') {
      args.out = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      printHelpAndExit();
    } else {
      console.error(`Unknown arg: ${arg}`);
      printHelpAndExit(1);
    }
  }
  return args;
}

function printHelpAndExit(code = 0): never {
  console.log(`
Usage: yarn summarize:ios-fit-report --input <benchmark-report.json> [--out <summary.md>]
`);
  process.exit(code);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    printHelpAndExit(1);
  }
  const report = JSON.parse(fs.readFileSync(args.input, 'utf8'));
  const summary = summarizeIosFitReport(report);
  const markdown = renderIosFitSummaryMarkdown(report, summary);
  if (args.out) {
    fs.writeFileSync(args.out, markdown);
  } else {
    process.stdout.write(markdown);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(`Error: ${(e as Error).message}`);
    process.exit(1);
  }
}
