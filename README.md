# Hyperliquid-style Perps Simulator

A safe, fully simulated practice environment that mimics the Hyperliquid perpetuals trading interface.

## Features
- Dark UI closely matching Hyperliquid’s layout (header, chart, order book, order panel, positions tab)
- Simulated USDC margin deposits / bridging
- Leverage slider (1x–50x) with live **notional** and **margin required** calculations
- Estimated liquidation price
- Place long or short market orders
- Positions appear in the bottom Positions table **and** as a dashed entry-price line on the chart
- Live unrealized PnL / ROE% as the simulated price moves
- Step-by-step overlay guide explaining margin deposits, bridging, leverage/notional, and the interface
- Everything is local and simulated — no wallet, no blockchain, no real funds

## Deploy
This is a static web app. Connect the GitHub repo to Vercel for instant hosting, or open index.html locally.

## Guide
Click **Start Guide** for the step-by-step overlay tutorial covering deposits, bridging, leverage & notional, placing a long, and seeing it on the chart + Positions tab.
