export enum RbStatus {
  Unknown = '—',
  NotInResp = 'не в респе',
  SoonResp = 'скоро респ',
  SoonSecondResp = 'скоро 2й респ',
  InResp = 'в респе',
  FirstRespPassed = 'первый респ прошел',
  SecondResp = 'во втором респе',
  Missed = 'проебан',
}

/** «Очистить респы» choices on the bookmark pages, in the order a boss goes through them */
export const CLEAR_STATUS_OPTIONS: { status: RbStatus; label: string }[] = [
  { status: RbStatus.NotInResp, label: 'Убит, не в респе' },
  { status: RbStatus.SoonResp, label: 'Скоро респ' },
  { status: RbStatus.InResp, label: 'В респе' },
  { status: RbStatus.FirstRespPassed, label: 'Первый респ прошёл' },
  { status: RbStatus.SoonSecondResp, label: 'Скоро 2-й респ' },
  { status: RbStatus.SecondResp, label: 'Во втором респе' },
  { status: RbStatus.Missed, label: 'Проебан' },
  { status: RbStatus.Unknown, label: 'Без статуса' },
];
