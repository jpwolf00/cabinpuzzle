# Overhead Bin: Boarding Rush

A puzzle game about the job nobody wants: you're the flight attendant, and the
whole plane is boarding at once.

Passengers stream down the aisle from nose to tail while a **boarding front**
sweeps aft with them. Tap open bin space ahead of the line to stow each bag.
Once the front passes a bin section, it's unreachable for the rest of the
flight — so empty space you leave up front is gone for good. Some bags are
secretly oversized and only reveal it when you try to stow them; those need a
pink tag. Fill a bin and latch it shut before the line reaches it for a bonus.

Four aircraft, easiest to hardest:

| | Aircraft | Cabin |
|---|---|---|
| ●○○○ | CRJ-200 | Cramped 1–2 section bins down one side, frequent pink tags |
| ●●○○ | A320 | Standard single aisle, even bins |
| ●●●○ | 737-900ER | Long tube, a lot of cabin to stay ahead of |
| ●●●● | 777-300ER | Twin aisle, four bin runs including two centre bins |

Single file, no build step, no dependencies. Open `index.html` in any browser,
or play it on GitHub Pages.

## Running locally

```
python3 -m http.server 8000
# then open http://localhost:8000
```

## Notes

Difficulty is tuned from simulated playtests rather than by feel: bots at
three sustained tap rates play the real game logic headlessly, and each
aircraft's boarding speed and packing target are set so a casual player clears
the training flight but has to improve to progress, while a competent player
clears all four.
