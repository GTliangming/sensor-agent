// 可招商的商户:押金、日租金、解锁等级。数值是占位的初版,调平衡时只改这里。

export interface MerchantDef {
    id: string;
    name: string;
    desc: string;
    /** 入驻押金;解约或收回铺面时退还。 */
    deposit: number;
    /** 每天收的租金。 */
    rentPerDay: number;
    unlockLevel: number;
}

export const MERCHANTS: MerchantDef[] = [
    { id: 'fruit', name: '水果档', desc: '新鲜水果摊,租金稳定', deposit: 300, rentPerDay: 45, unlockLevel: 4 },
    { id: 'bakery', name: '面包档', desc: '现烤面包,香味吸引人', deposit: 400, rentPerDay: 60, unlockLevel: 4 },
    { id: 'milktea', name: '奶茶档', desc: '年轻人爱去,租金较高', deposit: 500, rentPerDay: 80, unlockLevel: 5 },
    { id: 'deli', name: '熟食档', desc: '熟食卤味,租金最高', deposit: 600, rentPerDay: 95, unlockLevel: 6 },
];

export function getMerchant(id: string): MerchantDef | undefined {
    return MERCHANTS.filter((m) => m.id === id)[0];
}
