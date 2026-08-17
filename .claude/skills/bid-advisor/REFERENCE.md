# 評点帯ごとの入札基準

本当のワールドカップ 直近3シーズン（S6〜S8）の落札 638件（出場10試合以上）から算出。
`data/*__history.json` と `data/player-stats.json` を突き合わせたもの。

## 平均評点 × 落札実績

| 平均評点 | 件数 | 倍率中央値 | 上乗せ中央値 | 上位25% | 競合率 |
|---|---|---|---|---|---|
| 〜5.0 | 160 | **1.00** | +0 | +4 | 24% |
| 5.0〜5.3 | 242 | **1.11** | +1 | +6 | 29% |
| 5.3〜5.6 | 162 | **1.35** | +5 | +12 | 41% |
| 5.6〜6.0 | 68 | **1.56** | +9 | +20 | 50% |
| 6.0〜 | 6 | **2.05** | +45 | +51 | 50% |

**優秀な選手ほど二重に高くなる。**上乗せ自体が大きいうえ、競合率も 24% → 50% と倍増する。
「競合が起きにくいから安く済む」という前提は上位選手では成り立たない。

## 推奨額の出し方

1. 直近シーズンの平均評点から**倍率**を引く（上表）
2. `評価額 × 倍率` を基準額とする
3. 以下に当てはまれば**上位25%の水準まで積む**
   - 取り逃すと代替が効かない（GK など枠が限られるポジション）
   - 評価額が前シーズンより上昇している（他チームも注目している）
   - 過去に競合された実績がある

### 計算例

評価額15・平均評点5.39・GK の場合:

- 評点5.3〜5.6 帯 → 倍率1.35 → `15 × 1.35 = 20`
- GK は枠が限られる → 上位25%（+12）を考慮し **20〜24** を推奨

## ポジション別の競合時の上乗せ

同じ直近3シーズン。競り合いの激しさはポジションで大きく異なる。

| ポジション | 競合なし | 競合あり |
|---|---|---|
| GK | +1 | +4 |
| DF | +0 | +4 |
| MF | +1 | +9 |
| **FW** | +0 | **+16** |

FW は競合すると +16 と突出する。GK の基準をそのまま当てはめると確実に競り負ける。

## 注意

- 評点は**出場10試合以上**の選手に限って有効。少数試合の高評点は信頼できない
- 評点6.0以上は6件のみ。倍率2.05は参考値であり、実際は選手ごとに個別判断する
- 評価額が高い選手ほど絶対額の上振れが大きい（評点6.0帯の評価額中央値は39）

## 再現方法

```sh
node -e "
const fs=require('fs');
const stats=JSON.parse(fs.readFileSync('data/player-stats.json','utf8'));
const rows=[];
for(const f of fs.readdirSync('data').filter(f=>/PHDHUA3Z_[678]_.*__history/.test(f))){
  const j=JSON.parse(fs.readFileSync('data/'+f,'utf8'));
  for(const players of Object.values(j.mercato||{})) for(const p of Object.values(players)){
    if(!p.wonBid) continue;
    const d=new Date(p.wonBid.bidDate);
    const season=(d.getUTCMonth()+1>=7?d.getUTCFullYear():d.getUTCFullYear()-1);
    const s=stats[p.id+'|'+season];
    if(!s||s.matches<10) continue;
    rows.push({ratio:p.wonBid.price/p.quotation,over:p.wonBid.price-p.quotation,rating:s.rating,contested:(p.lostBids||[]).length>0});
  }
}
const med=a=>{const x=[...a].sort((p,q)=>p-q);return x.length?x[Math.floor(x.length/2)]:'-';};
for(const [lo,hi,l] of [[0,5.0,'〜5.0'],[5.0,5.3,'5.0-5.3'],[5.3,5.6,'5.3-5.6'],[5.6,6.0,'5.6-6.0'],[6.0,9,'6.0〜']]){
  const g=rows.filter(r=>r.rating>=lo&&r.rating<hi);
  if(g.length<3) continue;
  const p75=[...g.map(r=>r.over)].sort((a,b)=>a-b)[Math.floor(g.length*0.75)];
  console.log('評点'+l, g.length+'件', '倍率'+med(g.map(r=>r.ratio)).toFixed(2), '上乗せ+'+med(g.map(r=>r.over)), '上位25%+'+p75, '競合率'+Math.round(g.filter(r=>r.contested).length/g.length*100)+'%');
}
"
```
