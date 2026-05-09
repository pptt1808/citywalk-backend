/**
 * 终端状态可视化（对标调研文档中的 rich：颜色 + 表格）。
 * 用法: npx tsx scripts/agent-state-cli.ts [可选：task 字符串]
 */
import chalk from "chalk";
import Table from "cli-table3";
import { plannerService } from "../src/services/plannerService";
import { PlanRequest, StateEvent } from "../src/types/plan";

function panel(title: string, body: string, color: (s: string) => string) {
  const line = "─".repeat(Math.min(56, Math.max(24, body.split("\n").reduce((m, l) => Math.max(m, l.length), 0) + 4)));
  console.log(color(`┌${line}┐`));
  console.log(color(`│ ${title.padEnd(line.length - 2)} │`));
  console.log(color(`├${line}┤`));
  for (const row of body.split("\n")) {
    console.log(color(`│ ${row.padEnd(line.length - 2)} │`));
  }
  console.log(color(`└${line}┘`));
}

function printEvent(ev: StateEvent) {
  const head = chalk.bold(`[${ev.event_type}]`);
  switch (ev.event_type) {
    case "PLAN":
      panel(`${head} PLAN`, ev.content, chalk.blue);
      break;
    case "THINK":
      console.log(chalk.white(`${head} ${ev.content}`));
      break;
    case "ACTION": {
      console.log(chalk.yellow(`${head} ${ev.content}`));
      if (ev.tool_call) {
        const t = JSON.stringify(ev.tool_call, null, 2);
        console.log(chalk.yellow.dim(t));
      }
      break;
    }
    case "OBS": {
      console.log(chalk.green(`${head} ${ev.content}`));
      const out = ev.tool_call?.output;
      if (Array.isArray(out) && out.length && typeof out[0] === "object" && out[0] !== null && "name" in out[0]) {
        const table = new Table({
          head: ["名称", "地址", "评分"],
          colWidths: [22, 28, 8],
          style: { head: ["green"] }
        });
        for (const row of out.slice(0, 12) as { name?: string; address?: string; rating?: string | number }[]) {
          table.push([row.name ?? "", row.address ?? "", String(row.rating ?? "")]);
        }
        console.log(chalk.green(table.toString()));
      } else if (ev.tool_call) {
        console.log(chalk.green.dim(JSON.stringify(ev.tool_call, null, 2)));
      }
      break;
    }
    case "REFLECT":
      panel(`${head} REFLECT`, ev.content, chalk.red);
      break;
    case "RESULT":
      panel(`${head} RESULT`, ev.content, chalk.cyan);
      break;
    default:
      console.log(ev.content);
  }
  if (ev.context_snapshot && typeof ev.context_snapshot === "object") {
    const s = ev.context_snapshot as Record<string, unknown>;
    const budgetTable = new Table({
      head: ["预算", "已用", "时长上限", "已用时长", "天气风险"],
      style: { head: ["gray"] }
    });
    budgetTable.push([
      String(s.budget ?? ""),
      String(s.used_budget ?? ""),
      String(s.duration_minutes ?? ""),
      String(s.used_minutes ?? ""),
      String(s.weather_risk ?? "")
    ]);
    console.log(chalk.dim(budgetTable.toString()));
  }
  console.log();
}

async function main() {
  const taskArg = process.argv.slice(2).join(" ").trim();
  const input: PlanRequest = {
    task:
      taskArg ||
      "南京 CityWalk：从新街口出发，约3小时，预算200元，偏好书店、咖啡、博物馆。",
    city: "南京",
    startPoint: "新街口",
    durationMinutes: 180,
    budget: 200,
    preferences: ["书店", "咖啡", "博物馆"]
  };

  console.log(chalk.bold("\nCityWalk Pulse — 状态流 (F-04)\n"));

  const result = await plannerService.streamPlanWithStateEvents(input, (events) => {
    for (const ev of events) printEvent(ev);
  });

  console.log(chalk.cyan.bold("最终摘要:"), result.summary);
}

main().catch((err) => {
  console.error(chalk.red(err instanceof Error ? err.message : err));
  process.exit(1);
});
