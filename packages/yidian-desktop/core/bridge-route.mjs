// 本地桥的路由：请求 → 业务。
//
// 单独成模块是为了能脱离 Electron 测：main.mjs 只负责把 layer / pairing 注入进来。
import { BRIDGE_PATHS, BRIDGE_PROTOCOL_VERSION, fingerprintRecords } from '../vendor/yidian-core/bridge-protocol.mjs';
import * as domain from '../vendor/yidian-core/domain.mjs';

export function createBridgeRoute({ layer, pairing, version = '0.1.0', onEvent = null, onPaired = null, logger = null } = {}) {
  async function fullState() {
    const records = await layer.getRecords();
    const archived = await layer.getArchivedRecords();
    const settings = await layer.getSettings();
    return { ok: true, records, archived, settings, updatedAt: Date.now() };
  }

  return async function bridgeRoute({ method, path: routePath, body, context }) {
    const extensionId = context?.extensionId ?? null;

    if (method === 'GET' && routePath === BRIDGE_PATHS.ping) {
      return {
        body: {
          ok: true,
          app: 'yidian-desktop',
          version,
          protocol: BRIDGE_PROTOCOL_VERSION,
          paired: pairing.isPaired(extensionId),
          pairingOpen: pairing.isPairingOpen(),
        },
      };
    }

    if (method === 'POST' && routePath === BRIDGE_PATHS.pair) {
      const result = await pairing.handlePair({ body, extensionId });
      if (result?.body?.ok) {
        logger?.(`[本地桥] 浏览器扩展已配对（${extensionId.slice(0, 8)}…）`);
        await onPaired?.(extensionId);
      }
      return result;
    }

    if (method === 'GET' && routePath === BRIDGE_PATHS.state) {
      return { body: await fullState() };
    }

    if (method === 'POST' && routePath === BRIDGE_PATHS.records) {
      const incoming = Array.isArray(body?.records) ? body.records : [];
      const incomingArchived = Array.isArray(body?.archived) ? body.archived : [];
      const records = await layer.getRecords();
      const archived = await layer.getArchivedRecords();
      const merged = domain.consolidateRecords(domain.mergeByKey(records, incoming)).records;
      const mergedArchived = domain.consolidateRecords(domain.mergeByKey(archived, incomingArchived)).records;
      // 合并后没变化就不写盘：心跳每分钟推一次，别把磁盘写热。
      if (fingerprintRecords(merged) !== fingerprintRecords(records)) await layer.saveRecords(merged);
      if (fingerprintRecords(mergedArchived) !== fingerprintRecords(archived)) await layer.saveArchivedRecords(mergedArchived);
      logger?.(`[本地桥] 收到 ${incoming.length} 条记录，合并后 ${merged.length} 条`);
      return { body: await fullState() };
    }

    if (method === 'POST' && routePath === BRIDGE_PATHS.events) {
      const response = onEvent ? await onEvent(body) : { ok: false, error: '桌面端不支持这个动作' };
      return { body: { ok: true, response, state: await fullState() } };
    }

    return { status: 404, body: { ok: false, error: '未知接口' } };
  };
}
