import { CONFIG_BUNDLE } from "../src/data";
import { validateBundle } from "../src/core/validator";
import { solveLevel } from "../src/core/solver";

// 校验 src/data 下的全部配置并输出报告。用法：npm run validate:configs

const report = validateBundle(CONFIG_BUNDLE);

for (const level of CONFIG_BUNDLE.levels) {
  const solved = solveLevel(level);
  const status = solved.completable ? "PASS" : "FAIL";
  console.log(
    `[${status}] ${level.id} ${level.name}  物件 ${level.itemInstances.length}  ` +
      `最少失误 ${solved.minWrong}/${level.gridConfig.collectionSlots.capacity - 1}`,
  );
}
for (const e of report.errors) console.log(`[ERROR] ${e}`);
for (const w of report.warnings) console.log(`[WARN] ${w}`);
console.log(`\nResult: ${report.errors.length === 0 ? "PASSED" : "FAILED"}`);
console.log(`Errors: ${report.errors.length}  Warnings: ${report.warnings.length}`);
process.exit(report.errors.length === 0 ? 0 : 1);
