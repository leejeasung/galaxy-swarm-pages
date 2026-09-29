# Galaxy Swarm sprite sheets

게임 스펙의 2D 레트로 아케이드 아트 방향에 맞춘 투명 RGBA 스프라이트 시트입니다.

## 최종 런타임 시트

| 폴더 | 파일 | 크기 | 격자 | 셀 |
| --- | --- | ---: | ---: | ---: |
| `player/` | `player-sheet.png` | 256×128 | 4×2 | 64×64 |
| `enemies/` | `enemies-sheet.png` | 256×256 | 4×4 | 64×64 |
| `boss/` | `boss-sheet.png` | 256×256 | 2×2 | 128×128 |
| `vfx/` | `vfx-sheet.png` | 256×256 | 4×4 | 64×64 |

플레이어·일반 적·VFX 시트는 64px 셀, 보스 시트는 128px 셀이라서 각 시트의 source rectangle에 바로 사용할 수 있습니다.

```js
ctx.drawImage(sheet, column * 64, row * 64, 64, 64, x - 32, y - 32, 64, 64);
// boss-sheet.png만 128px 셀을 사용합니다.
ctx.drawImage(bossSheet, column * 128, row * 128, 128, 128, x - 64, y - 64, 128, 128);
```

적은 화면 위에서 아래로 내려오는 방향을 기준으로 제작했습니다. 모든 적의 전면/무기/코어는 셀의 아래쪽, 후면 엔진과 이동 잔광은 위쪽에 있습니다. 공격 상태는 아래쪽 전면 발광, 이동 상태는 위쪽 후면 잔광을 사용합니다.

## 프레임 매핑

### `player/player-sheet.png`

읽기 순서(왼쪽→오른쪽, 위→아래):

0. idle
1. engine-small
2. engine-bright
3. bank-left
4. bank-right
5. invincibility-outline
6. hit-flash
7. dual-pod

### `enemies/enemies-sheet.png`

보스가 제거된 일반 적 전용 시트입니다. 열은 적 종류, 행은 상태입니다.

열(왼쪽→오른쪽): swarm · diver · guardian · commander

행(위→아래): basic-idle · attack · move · wait

프레임 인덱스는 행 우선 순서입니다:

0. swarm-basic-idle · 1. diver-basic-idle · 2. guardian-basic-idle · 3. commander-basic-idle
4. swarm-attack · 5. diver-attack · 6. guardian-attack · 7. commander-attack
8. swarm-move · 9. diver-move · 10. guardian-move · 11. commander-move
12. swarm-wait · 13. diver-wait · 14. guardian-wait · 15. commander-wait

### `boss/boss-sheet.png`

보스 전용 128px 셀 시트입니다. 2×2 격자의 행 우선 순서로 basic-idle, attack, move, wait를 담았습니다. 일반 적 시트와 분리해 보스의 큰 날개와 코어가 잘리지 않도록 했습니다.

### `vfx/vfx-sheet.png`

0. player-bolt · 1. player-bolt-trail · 2. enemy-bolt · 3. guardian-orb
4. hit-small · 5. hit-bright · 6. enemy-burst-small · 7. enemy-burst-large
8. player-damage · 9. player-defeat · 10. boss-core-closed · 11. boss-core-open
12. attack-warning · 13. re-entry-warp · 14. wave-clear · 15. combo-sparkle

## 원본

`_source/`에는 생성 직후의 고해상도 RGBA 시트와 이전 적 시트의 보관본을 남겼습니다. 런타임에서는 셀별 투명 여백을 보장한 정규화 시트를 사용합니다.

