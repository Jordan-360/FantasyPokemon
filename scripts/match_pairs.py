"""
FantasyPokemon — Pokémon ↔ NFL starter matching.

Rebuilds the 704 Pokémon–player pairs (Gens 1–6) from public data.
Madden ratings are NOT fetched here (EA has no public API); they were
joined separately and live in src/data/pairs.json.

Inputs (download into one folder and pass it as --data):
  PokeAPI CSVs   https://github.com/PokeAPI/pokeapi/tree/master/data/v2/csv
                 pokemon_stats.csv, pokemon_types.csv, pokemon_species_names.csv
  nflverse       https://github.com/nflverse/nflverse-data/releases
                 depth_charts/depth_charts_2026.csv
                 stats_player/stats_player_week_2026.csv
                 stats_player/stats_player_reg_2025.csv

Usage:
  pip install numpy scipy
  python match_pairs.py --data ./raw --date 2026-10-28 --out pairs_raw.json

Method
  1. Pool: each team's top 22 from today's depth chart
     (QB1, RB1-2, WR1-4, TE1-2, K, 12 defenders) = 704 players.
  2. Players ranked within position by per-game production:
     65% 2026 + 35% 2025, shrunk toward 0 for small samples (games + 2).
  3. Pokémon: the 17 lowest base-stat totals sit out (721 -> 704).
  4. Each Pokémon gets a position "fit" from its stat SHAPE (z-scored
     proportions, so raw power doesn't decide position) plus type bonuses.
     An optimal assignment (Hungarian algorithm) fills exact slot quotas.
  5. Within each position, Pokémon are ranked by weighted raw stats
     ("power") and paired rank-for-rank with the NFL players.
"""
import argparse, csv, json
from collections import defaultdict
import numpy as np
from scipy.optimize import linear_sum_assignment

ap = argparse.ArgumentParser()
ap.add_argument('--data', required=True)
ap.add_argument('--date', required=True, help='depth chart snapshot date, YYYY-MM-DD')
ap.add_argument('--out', default='pairs_raw.json')
a = ap.parse_args()
P = lambda f: f'{a.data}/{f}'

# ---------------- Pokémon ----------------
TYPES = {1:'Normal',2:'Fighting',3:'Flying',4:'Poison',5:'Ground',6:'Rock',7:'Bug',8:'Ghost',9:'Steel',
         10:'Fire',11:'Water',12:'Grass',13:'Electric',14:'Psychic',15:'Ice',16:'Dragon',17:'Dark',18:'Fairy'}
MAX_ID = 721
names = {int(r['pokemon_species_id']): r['name']
         for r in csv.DictReader(open(P('pokemon_species_names.csv'), encoding='utf-8'))
         if r['local_language_id'] == '9'}
stats = defaultdict(dict)
for r in csv.DictReader(open(P('pokemon_stats.csv'))):
    if int(r['pokemon_id']) <= MAX_ID:
        stats[int(r['pokemon_id'])][int(r['stat_id'])] = int(r['base_stat'])
ptypes = defaultdict(list)
for r in csv.DictReader(open(P('pokemon_types.csv'))):
    if int(r['pokemon_id']) <= MAX_ID:
        ptypes[int(r['pokemon_id'])].append((int(r['slot']), TYPES[int(r['type_id'])]))
ids = list(range(1, MAX_ID + 1))
S = np.array([[stats[i][k] for k in range(1, 7)] for i in ids], float)  # hp atk def spa spd spe
tp = [[t for _, t in sorted(ptypes[i])] for i in ids]
bst = S.sum(1)

POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']
W = {  # weights: hp, atk, def, spa, spd, spe
    'QB':  [0.10, 0.00, 0.05, 0.35, 0.25, 0.25],
    'RB':  [0.20, 0.30, 0.15, 0.00, 0.05, 0.30],
    'WR':  [0.05, 0.25, 0.00, 0.10, 0.05, 0.55],
    'TE':  [0.30, 0.30, 0.25, 0.00, 0.05, 0.10],
    'K':   [0.00, 0.15, 0.00, 0.35, 0.15, 0.35],
    'DEF': [0.25, 0.30, 0.30, 0.00, 0.15, 0.00],
}
TYPE_BONUS = {
    'QB': {'Psychic': 1.0, 'Fairy': 0.3, 'Dragon': 0.3},
    'RB': {'Normal': 0.7, 'Ground': 0.5, 'Fire': 0.3},
    'WR': {'Flying': 0.8, 'Electric': 0.8, 'Bug': 0.2},
    'TE': {'Water': 0.5, 'Normal': 0.3, 'Poison': 0.3},
    'K':  {'Fairy': 0.4, 'Grass': 0.2},
    'DEF': {'Fighting': 0.8, 'Rock': 0.7, 'Ground': 0.5, 'Steel': 0.7, 'Dark': 0.4},
}
OVERRIDE = {106: 'K'}  # Hitmonlee is a kicker.
QUOTA = {'QB': 32, 'RB': 64, 'WR': 128, 'TE': 64, 'K': 32, 'DEF': 384}

shape = S / S.sum(1, keepdims=True)
z = (shape - shape.mean(0)) / shape.std(0)
fit = np.zeros((len(ids), len(POS)))
for j, p in enumerate(POS):
    fit[:, j] = z @ np.array(W[p]) + np.array([sum(TYPE_BONUS[p].get(t, 0) for t in ts) for ts in tp])
fit[:, POS.index('K')] -= (bst - bst.mean()) / bst.std() * 0.6   # kickers skew small
power = {p: S @ np.array(W[p]) for p in POS}

n_keep = sum(QUOTA.values())
dropped = set(sorted(ids, key=lambda i: (bst[i - 1], -i))[:len(ids) - n_keep])
keep = [i for i in ids if i not in dropped]
cols = [p for p in POS for _ in range(QUOTA[p])]
cost = np.zeros((len(keep), len(cols)))
for c, p in enumerate(cols):
    cost[:, c] = -fit[[i - 1 for i in keep], POS.index(p)]
for r_, i in enumerate(keep):
    if i in OVERRIDE:
        cost[r_, :] = 1e6
        cost[r_, [c for c, p in enumerate(cols) if p == OVERRIDE[i]]] = -1e6
rr, cc = linear_sum_assignment(cost)
pk_pos = {keep[x]: cols[y] for x, y in zip(rr, cc)}

# ---------------- NFL ----------------
def f(x):
    try: return float(x)
    except (TypeError, ValueError): return 0.0

def pts(row, p):
    if p in ('QB', 'RB', 'WR', 'TE'):
        return f(row['fantasy_points_ppr'])
    if p == 'K':
        return (3 * f(row['fg_made']) + f(row['fg_made_50_59']) + 2 * f(row['fg_made_60_'])
                + f(row['pat_made']) - f(row['fg_missed']) - f(row['pat_missed']))
    return (f(row['def_tackles_solo']) + 0.5 * f(row['def_tackle_assists']) + f(row['def_tackles_for_loss'])
            + 4 * f(row['def_sacks']) + f(row['def_qb_hits']) + 5 * f(row['def_interceptions'])
            + 2 * f(row['def_pass_defended']) + 3 * f(row['def_fumbles_forced']) + 3 * f(row['fumble_recovery_opp'])
            + 6 * f(row['def_tds']) + 2 * f(row['def_safeties']))

def load(path, weekly):
    tot = defaultdict(lambda: defaultdict(float)); g = defaultdict(int)
    for row in csv.DictReader(open(path)):
        if row['season_type'] != 'REG': continue
        for p in POS: tot[row['player_id']][p] += pts(row, p)
        if weekly: g[row['player_id']] += 1
        else: g[row['player_id']] = int(f(row.get('games')))
    return tot, g

t26, g26 = load(P('stats_player_week_2026.csv'), True)
t25, g25 = load(P('stats_player_reg_2025.csv'), False)

def score(pid, p):
    r26 = t26[pid][p] / (g26[pid] + 2) if pid in t26 else 0.0
    r25 = t25[pid][p] / (g25[pid] + 2) if pid in t25 and g25[pid] else None
    return r26 if r25 is None else 0.65 * r26 + 0.35 * r25

dc = [x for x in csv.DictReader(open(P('depth_charts_2026.csv'))) if x['dt'].startswith(a.date)]
DEFSLOTS = {'LDE','RDE','NT','LDT','RDT','WLB','SLB','MLB','LILB','RILB','LCB','RCB','SS','FS','NB'}
nfl = defaultdict(list)
for team in sorted({x['team'] for x in dc}):
    rows = [x for x in dc if x['team'] == team]
    used = set()
    srt = lambda L: sorted(L, key=lambda x: int(x['pos_rank']))
    def take(p, cands, n):
        for x in srt(cands):
            if n == 0: break
            if not x['gsis_id'] or x['gsis_id'] in used: continue
            used.add(x['gsis_id']); n -= 1
            nfl[p].append({'name': x['player_name'], 'team': team, 'slot': x['pos_abb'],
                           'gsis_id': x['gsis_id'], 'score': score(x['gsis_id'], p)})
        if n: print(f'WARNING {team} short {n} at {p}')
    take('QB',  [x for x in rows if x['pos_abb'] == 'QB'], 1)
    take('RB',  [x for x in rows if x['pos_abb'] == 'RB'], 2)
    take('WR',  [x for x in rows if x['pos_abb'] == 'WR' and x['pos_grp'] != 'Special Teams'], 4)
    take('TE',  [x for x in rows if x['pos_abb'] == 'TE'], 2)
    take('K',   [x for x in rows if x['pos_abb'] == 'PK'], 1)
    take('DEF', [x for x in rows if x['pos_abb'] in DEFSLOTS], 12)

out = []
for p in POS:
    nfl[p].sort(key=lambda d: -d['score'])
    mons = sorted([i for i in keep if pk_pos[i] == p], key=lambda i: -power[p][i - 1])
    for rank, (i, pl) in enumerate(zip(mons, nfl[p]), 1):
        out.append({'dex': i, 'pokemon': names[i], 'types': tp[i - 1], 'fantasyPos': p, 'posRank': rank,
                    'nfl': {'name': pl['name'], 'team': pl['team'], 'depthSlot': pl['slot'],
                            'gsisId': pl['gsis_id'], 'productionScore': round(pl['score'], 2)}})
out.sort(key=lambda d: d['dex'])
json.dump({'pairs': out, 'unmatched': [names[i] for i in sorted(dropped)]},
          open(a.out, 'w'), ensure_ascii=False, indent=1)
print(f'{len(out)} pairs -> {a.out}')
