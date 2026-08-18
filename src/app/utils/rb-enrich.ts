import { RbStatus } from '../constants/status';

function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addHours(date: Date | null, hours: any): Date | null {
  if (!date) return null;
  const hoursNumber = Number(hours);
  if (!Number.isFinite(hoursNumber)) return date;
  return new Date(date.getTime() + hoursNumber * 60 * 60 * 1000);
}

function calculateStatus(
  minResp: Date | null,
  maxResp: Date | null,
  secondMinResp: Date | null,
  secondMaxResp: Date | null
): RbStatus {
  if (!minResp || !maxResp || !secondMinResp || !secondMaxResp) return RbStatus.Unknown;

  const now = Date.now();
  const hourMs = 60 * 60 * 1000;
  const min = minResp.getTime();
  const max = maxResp.getTime();
  const secondMin = secondMinResp.getTime();
  const secondMax = secondMaxResp.getTime();

  if (now < min) {
    if (min - now <= hourMs) return RbStatus.SoonResp;
    return RbStatus.NotInResp;
  }
  if (now >= min && now <= max) return RbStatus.InResp;
  if (now > max && now < secondMin) {
    if (secondMin - now <= hourMs) return RbStatus.SoonSecondResp;
    return RbStatus.FirstRespPassed;
  }
  if (now >= secondMin && now <= secondMax) return RbStatus.SecondResp;
  return RbStatus.Missed;
}

// Derives the respawn windows + status for a raw raid-boss record (as returned by
// RbData.getItems()). Shared by every page that lists raid bosses so the resp math
// stays in one place.
export function enrichRbItem(item: any): any {
  const deadTime = toDate(item?.lastDeadTime);
  const respTimeHours = item?.meta?.respTime;
  const plusMinusHours = item?.meta?.plusMinusRespTime;

  const minResp = addHours(deadTime, respTimeHours);
  const maxResp = addHours(minResp, plusMinusHours);

  const secondMinResp = addHours(minResp, respTimeHours);
  const secondMaxResp = addHours(maxResp, (Number(respTimeHours) || 0) + (Number(plusMinusHours) || 0));

  const status = calculateStatus(minResp, maxResp, secondMinResp, secondMaxResp);

  return {
    ...item,
    deadTime,
    minResp,
    maxResp,
    secondMinResp,
    secondMaxResp,
    status,
  };
}
