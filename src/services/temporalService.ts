import {
  RouteLeg,
  RouteStop,
  TravelTemporalConstraint,
  TravelTemporalInput,
  TravelTimePeriod
} from "../types/plan";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

const PERIOD_START: Record<TravelTimePeriod, string> = {
  morning: "09:00",
  afternoon: "14:00",
  evening: "18:00",
  night: "20:00"
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function shanghaiParts(value: Date): { date: string; time: string } {
  const shifted = new Date(value.getTime() + SHANGHAI_OFFSET_MS);
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
  };
}

function dateToUtc(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function validDate(value?: string): value is string {
  if (!value || !DATE_RE.test(value)) return false;
  const parsed = dateToUtc(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validTime(value?: string): value is string {
  return Boolean(value && TIME_RE.test(value));
}

function addDays(date: string, days: number): string {
  const value = dateToUtc(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function shanghaiIso(date: string, time: string): string {
  return `${date}T${time}:00+08:00`;
}

function chineseNumber(value: string): number | undefined {
  if (/^\d{1,2}$/u.test(value)) return Number(value);
  const digits: Record<string, number> = {
    零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9
  };
  if (value === "十") return 10;
  if (value.includes("十")) {
    const [left, right] = value.split("十");
    return (left ? digits[left] : 1) * 10 + (right ? digits[right] : 0);
  }
  return digits[value];
}

function normalizeHour(hour: number, marker?: string): number | undefined {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return undefined;
  if (/下午|傍晚|晚上|今晚|夜里|夜间/u.test(marker ?? "") && hour < 12) return hour + 12;
  if (marker === "中午" && hour < 11) return hour + 12;
  if (marker === "凌晨" && hour === 12) return 0;
  if (/上午|早上|早晨/u.test(marker ?? "") && hour === 12) return 0;
  return hour;
}

function inferPeriod(marker?: string): TravelTimePeriod | undefined {
  if (/早上|早晨|上午|日出/u.test(marker ?? "")) return "morning";
  if (/中午|下午/u.test(marker ?? "")) return "afternoon";
  if (/傍晚|晚上|今晚|黄昏|日落/u.test(marker ?? "")) return "evening";
  if (/夜里|夜间|夜游|深夜/u.test(marker ?? "")) return "night";
  return undefined;
}

function extractDate(task: string, now: Date): { visitDate?: string; source?: string } {
  const today = shanghaiParts(now).date;
  const absolute = task.match(/\b(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日|号)?\b/u);
  if (absolute) {
    const value = `${absolute[1]}-${pad(Number(absolute[2]))}-${pad(Number(absolute[3]))}`;
    return validDate(value) ? { visitDate: value, source: absolute[0] } : {};
  }
  const monthDay = task.match(/(?:^|[^\d])(\d{1,2})月(\d{1,2})(?:日|号)/u);
  if (monthDay) {
    const currentYear = Number(today.slice(0, 4));
    let value = `${currentYear}-${pad(Number(monthDay[1]))}-${pad(Number(monthDay[2]))}`;
    if (validDate(value) && value < today) value = `${currentYear + 1}-${pad(Number(monthDay[1]))}-${pad(Number(monthDay[2]))}`;
    return validDate(value) ? { visitDate: value, source: monthDay[0].trim() } : {};
  }
  if (/大后天/u.test(task)) return { visitDate: addDays(today, 3), source: "大后天" };
  if (/后天/u.test(task)) return { visitDate: addDays(today, 2), source: "后天" };
  if (/明天|明日/u.test(task)) return { visitDate: addDays(today, 1), source: task.includes("明天") ? "明天" : "明日" };
  if (/今天|今日|今晚|今早/u.test(task)) return { visitDate: today, source: task.match(/今天|今日|今晚|今早/u)?.[0] };

  const weekday = task.match(/(本周|这周|下周)?(?:周|星期|礼拜)([一二三四五六日天])/u);
  if (weekday) {
    const target = ({ 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 } as Record<string, number>)[weekday[2]];
    const currentJsDay = dateToUtc(today).getUTCDay();
    const current = currentJsDay === 0 ? 7 : currentJsDay;
    let delta = target - current;
    if (weekday[1] === "下周") delta = target + 7 - current;
    else if (delta < 0) delta += 7;
    return { visitDate: addDays(today, delta), source: weekday[0] };
  }
  return {};
}

function extractClock(task: string): { startTime?: string; period?: TravelTimePeriod; source?: string } {
  const match = task.match(
    /(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|今晚|夜里|夜间)?\s*(\d{1,2}|[零一二两三四五六七八九十]{1,3})\s*(?:[:：]\s*(\d{1,2})|点\s*(半|\d{1,2}分?)?|时(?!小)\s*(\d{1,2}分?)?)/u
  );
  // “轻松一点 / 少走一点” contains the lexical string “一点” but is not
  // a clock. Bare numeric “1点” remains valid; Chinese “一点” needs a time
  // marker or an adjacent departure/clock cue.
  const bareChineseClock = match && !match[1] && !/^\d+$/u.test(match[2]);
  const hasBareClockCue = match && (match[4] === "半"
    || new RegExp(`${match[2]}点\\s*(?:钟|左右|前|后|出发|开始|集合|到达)`, "u").test(task));
  const ambiguousChineseClock = Boolean(bareChineseClock && !hasBareClockCue);
  if (match && !ambiguousChineseClock) {
    const rawHour = chineseNumber(match[2]);
    const hour = rawHour == null ? undefined : normalizeHour(rawHour, match[1]);
    const minuteText = match[3] ?? match[4] ?? match[5] ?? "0";
    const minute = minuteText === "半" ? 30 : Number(minuteText.replace("分", ""));
    if (hour != null && minute >= 0 && minute <= 59) {
      return {
        startTime: `${pad(hour)}:${pad(minute)}`,
        period: inferPeriod(match[1]),
        source: match[0].trim()
      };
    }
  }
  const marker = task.match(/早上|早晨|上午|日出|中午|下午|傍晚|晚上|今晚|黄昏|日落|夜里|夜间|夜游|深夜/u)?.[0];
  return marker ? { period: inferPeriod(marker), source: marker } : {};
}

function normalizeCandidate(value?: TravelTemporalInput): TravelTemporalInput | undefined {
  if (!value) return undefined;
  if (value.departureAt) {
    const parsed = new Date(value.departureAt);
    if (Number.isFinite(parsed.getTime())) {
      const parts = shanghaiParts(parsed);
      return { ...value, visitDate: parts.date, startTime: parts.time, precision: "exact" };
    }
  }
  return {
    ...value,
    visitDate: validDate(value.visitDate) ? value.visitDate : undefined,
    startTime: validTime(value.startTime) ? value.startTime : undefined
  };
}

export function parseTravelTemporal(task: string, now = new Date()): TravelTemporalInput | undefined {
  if (!task.trim()) return undefined;
  if (/现在|马上|即刻|立刻出发/u.test(task)) {
    const parts = shanghaiParts(now);
    return {
      timezone: "Asia/Shanghai",
      visitDate: parts.date,
      startTime: parts.time,
      departureAt: shanghaiIso(parts.date, parts.time),
      precision: "exact",
      sourceText: task.match(/现在|马上|即刻|立刻出发/u)?.[0]
    };
  }
  const date = extractDate(task, now);
  const clock = extractClock(task);
  if (!date.visitDate && !clock.startTime && !clock.period) return undefined;
  // A clock without a date is interpreted as today, but remains marked as an
  // inference so clients can disclose the assumption instead of hiding it.
  const visitDate = date.visitDate ?? shanghaiParts(now).date;
  return {
    timezone: "Asia/Shanghai",
    visitDate,
    startTime: clock.startTime,
    period: clock.period,
    precision: clock.startTime ? "exact" : clock.period ? "period" : "date_only",
    sourceText: [date.source, clock.source].filter(Boolean).join(" ") || undefined,
    inferred: !date.visitDate,
    dateInferred: !date.visitDate
  };
}

/** Merge partial temporal constraints in priority order without losing a previous time when only the date is edited. */
export function resolveTravelTemporal(
  ...values: Array<TravelTemporalInput | TravelTemporalConstraint | undefined>
): TravelTemporalConstraint {
  const candidates = values.map(normalizeCandidate).filter((value): value is TravelTemporalInput => Boolean(value));
  const meaningful = candidates.filter((value) => value.visitDate || value.startTime || value.period || value.departureAt);
  if (!meaningful.length) return { timezone: "Asia/Shanghai", precision: "unspecified" };
  const pick = <K extends keyof TravelTemporalInput>(field: K): TravelTemporalInput[K] | undefined => {
    for (const candidate of meaningful) {
      if (candidate[field] !== undefined) return candidate[field];
    }
    return undefined;
  };
  const primary = meaningful[0];
  // A time-only current turn initially carries today's date so it works as a
  // standalone request. During a route edit, an older explicit route date is
  // stronger than that temporary date and must be inherited instead.
  const visitDate = meaningful.find((candidate) => candidate.visitDate && !candidate.dateInferred)?.visitDate
    ?? pick("visitDate");
  // A new period (“改成晚上”) replaces the old clock. A date-only edit may
  // intentionally inherit the previous route clock.
  const explicitTime = primary.startTime
    ?? (primary.period ? undefined : meaningful.slice(1).find((candidate) => candidate.startTime)?.startTime);
  const period = primary.period
    ?? (primary.startTime ? undefined : meaningful.slice(1).find((candidate) => candidate.period)?.period);
  const startTime = explicitTime ?? (period ? PERIOD_START[period] : undefined);
  const precision = explicitTime ? "exact" : period ? "period" : visitDate ? "date_only" : "unspecified";
  const departureAt = visitDate && startTime ? shanghaiIso(visitDate, startTime) : undefined;
  return {
    timezone: "Asia/Shanghai",
    precision,
    visitDate,
    startTime,
    departureAt,
    period,
    sourceText: primary.sourceText,
    inferred: Boolean(primary.inferred)
      || Boolean(period && !explicitTime)
      || Boolean((primary.visitDate && !primary.startTime && startTime) || (!primary.visitDate && visitDate))
  };
}

export function describeTravelTemporal(value: TravelTemporalConstraint): string {
  if (value.precision === "unspecified") return "未指定出行时间";
  if (value.precision === "date_only") return `${value.visitDate}（未指定出发时刻）`;
  const periodLabel: Record<TravelTimePeriod, string> = {
    morning: "上午", afternoon: "下午", evening: "傍晚", night: "夜间"
  };
  const prefix = value.period && value.precision === "period" ? `${periodLabel[value.period]}约` : "";
  return `${value.visitDate} ${prefix}${value.startTime}`;
}

export function addMinutesToIso(value: string, minutes: number): string {
  const parsed = new Date(value);
  const next = new Date(parsed.getTime() + Math.max(0, minutes) * 60_000);
  const parts = shanghaiParts(next);
  return shanghaiIso(parts.date, parts.time);
}

export function formatShanghaiClock(value?: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return undefined;
  return shanghaiParts(parsed).time;
}

export function scheduleRouteByDeparture(
  stops: RouteStop[],
  legs: RouteLeg[],
  temporal: TravelTemporalConstraint
): { stops: RouteStop[]; legs: RouteLeg[]; endAt?: string } {
  if (!temporal.departureAt) return { stops, legs };
  let cursor = temporal.departureAt;
  let legCursor = 0;
  const scheduledLegs = legs.map((leg) => ({ ...leg }));
  const scheduledStops = stops.map((stop) => {
    let legIndex = scheduledLegs.findIndex((leg, index) => index >= legCursor && leg.destinationName === stop.name);
    if (legIndex < 0 && stop.location && legCursor < scheduledLegs.length) legIndex = legCursor;
    if (legIndex >= 0) {
      const leg = scheduledLegs[legIndex];
      leg.estimatedDepartureAt = cursor;
      cursor = addMinutesToIso(cursor, leg.durationMinutes);
      leg.estimatedArrivalAt = cursor;
      legCursor = legIndex + 1;
    }
    const estimatedArrivalAt = cursor;
    cursor = addMinutesToIso(cursor, stop.estimatedStayMinutes);
    return { ...stop, estimatedArrivalAt, estimatedDepartureAt: cursor };
  });
  return { stops: scheduledStops, legs: scheduledLegs, endAt: cursor };
}
