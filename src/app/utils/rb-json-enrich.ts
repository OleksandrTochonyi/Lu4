import { JsonRb } from '../services/rb-json-data.service';
import { enrichRbItem } from './rb-enrich';

// Adapts a JsonRb (db.json catalog + rb-resp-time kill-time) into the shape enrichRbItem
// expects (`lastDeadTime` + `meta.respTime`/`meta.plusMinusRespTime`), so the JSON pages
// compute resp windows/status with the exact same formula as the old Home/Bookmarks pages.
export function enrichJsonRb(item: JsonRb): any {
  return enrichRbItem({
    ...item,
    lastDeadTime: item.lastDeadTime ?? null,
    meta: {
      respTime: item.stats?.minResp,
      plusMinusRespTime: item.stats?.plusResp,
    },
  });
}
