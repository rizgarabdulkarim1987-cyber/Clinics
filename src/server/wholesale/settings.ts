/* eslint-disable no-restricted-properties -- the row lock binds the company's own id */
import { Prisma } from '@/generated/prisma/client';
import type { ScopedTx } from '@/server/data/tenant-db';
import { assertSetting, isSettingKey, settingOrDefault, InvalidSettingError, SETTING_KEYS, type SettingKey, type SettingValues } from '@/server/domain/wholesale/settings';

export { InvalidSettingError, SETTING_DEFAULTS, SETTING_KEYS, type CreditLimitMode, type SettingCurrency, type SettingKey, type SettingValues } from '@/server/domain/wholesale/settings';

type Db = ScopedTx;

/** A setting's value (its default when it was never set). */
export async function getSetting<K extends SettingKey>(tx: Db, key: K): Promise<SettingValues[K]> {
  if (!isSettingKey(key)) throw new InvalidSettingError(`unknown setting: ${String(key)}`);
  const row = await tx.whSetting.findFirst({ where: { key }, select: { value: true } });
  return settingOrDefault(key, row?.value);
}

/** Every setting in one query (defaults for the unset or invalid ones). */
export async function getSettings(tx: Db): Promise<SettingValues> {
  const rows = await tx.whSetting.findMany({ where: { key: { in: [...SETTING_KEYS] } }, select: { key: true, value: true } });
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(SETTING_KEYS.map((k) => [k, settingOrDefault(k, stored.get(k))])) as SettingValues;
}

/** Sets a setting after validating it. The caller checks `settings.manage`. */
export async function setSettingTx<K extends SettingKey>(tx: Db, rid: string, userId: string, key: K, value: SettingValues[K]): Promise<void> {
  assertSetting(key, value);
  await tx.$queryRaw`SELECT id FROM "WhSetting" WHERE key = ${key} AND "restaurantId" = ${rid} FOR UPDATE`;
  // A Json column stores SQL-level JSON null through Prisma.JsonNull (themeAccent: null = "derive it").
  const json = value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
  await tx.whSetting.upsert({
    where: { restaurantId_key: { restaurantId: rid, key } },
    create: { restaurantId: rid, key, value: json, updatedById: userId },
    update: { value: json, updatedById: userId },
  });
}
