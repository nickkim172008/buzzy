# Buzzy

Buzzy is a full-stack cultural hype market platform where users can discover, suggest, vote on, and trade virtual assets based on real-world cultural trends. Assets can represent music artists, fashion items, sports moments, memes, events, products, or other cultural signals.

The platform simulates a market-driven economy where users buy into assets they believe will gain popularity. Asset prices are determined by user trading activity rather than randomly generated values.

## Live Demo

https://buzzly-zeta.vercel.app

## Repository

https://github.com/nickkim172008/buzzly

## Tech Stack

- **Framework:** Next.js
- **Frontend:** React, TypeScript
- **Styling:** Tailwind CSS
- **Authentication:** Firebase Authentication
- **Database:** Cloud Firestore
- **Deployment:** Vercel

## Core Features

- Firebase-based user authentication
- Real-time cultural asset listings
- Asset detail pages with market data
- Community asset suggestion system
- Voting system for proposed assets
- Drop-based initial asset distribution
- Virtual portfolio and holdings tracking
- Buy and sell order functionality
- Order book implementation
- Trade history tracking
- Dynamic price updates based on completed trades
- Firestore-backed data persistence

## System Overview

Buzzy uses a drop-based launch model to introduce new assets into the platform economy. Each asset begins with an initial supply that users can purchase at a fixed starting price during the drop phase.

After the drop phase ends, the asset transitions into open trading. Users can place buy and sell orders against available market supply. When orders are matched and trades are completed, asset ownership, user balances, holdings, and price history are updated in Firestore.

This structure prevents assets from entering open trading with no initial holders and helps maintain a more realistic closed-economy model.

## Trading Logic

The trading system was designed around a virtual closed economy. Instead of generating artificial price movement, Buzzy updates asset prices based on completed user transactions.

Key trading mechanics include:

- Initial fixed-price asset drops
- User balance validation before purchases
- Asset ownership validation before sell orders
- Token transfer from buyer to seller
- Asset quantity transfer from seller to buyer
- Price updates based on last completed trade
- Persistent order and trade records
- User holdings updates after each transaction

## Data Model

Buzzy relies on Cloud Firestore to store and synchronize platform data, including:

- Users
- Assets
- Suggested assets
- Votes
- Holdings
- Orders
- Trades
- Price history

Firestore was used to support real-time updates and simplify synchronization between user actions and market state.

## Technical Challenges

One of the main challenges was designing the market structure. In an open trading system, assets need existing holders before users can buy from one another. To solve this, we implemented a drop system that creates an initial distribution phase before peer-to-peer trading begins.

Another major challenge was maintaining consistency across user balances, asset quantities, holdings, orders, and trade history. Since each trade affects multiple records, the app needed careful state updates to prevent duplicate assets, missing tokens, or incorrect portfolio values.

## What We Learned

Building Buzzy required more than frontend development. We had to think through market design, transaction flow, database structure, user incentives, and the limitations of building investment-like experiences with virtual assets.

This project helped us better understand:

- Full-stack application architecture with Next.js and Firebase
- Real-time database design using Firestore
- Authentication and user-specific data modeling
- Market mechanics such as drops, order books, and trade execution
- The importance of data consistency in transaction-based systems
- Product and legal considerations around virtual economies
