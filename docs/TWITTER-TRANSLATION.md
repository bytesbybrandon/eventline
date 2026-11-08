# Design Twitter: DSL → Architecture Translation

This document shows how each DSL primitive maps to real infrastructure components. Use this as a reference when translating an event model into a system design diagram.

---

## Translation Principles

1. **Actors → Edge / Clients**: Who is calling the system
2. **Commands → API Endpoints / Services**: What they can do
3. **Boundaries → Data Stores / Partitions**: Where state lives
4. **Views → Caches / Read Models**: How we serve reads
5. **Policies → Async Workers / Message Queues**: What happens in the background

The DSL doesn't draw the diagram for you. It tells you *what* to draw.

---

## 1. Actors → Edge / Load Balancing

### DSL

```text
actor User { auth: session, tier: free|pro|enterprise }
actor Admin { auth: oauth, mfa: required }
actor Visitor { auth: none }
```

### Architecture

```
┌─────────────┐     ┌─────────────┐
│   Mobile    │     │    Web      │
│   Client    │     │   Client    │
└──────┬──────┘     └──────┬──────┘
       │                   │
       └─────────┬─────────┘
                 │
          ┌──────▼──────┐
          │   CDN       │
          │ (CloudFront)│
          └──────┬──────┘
                 │
          ┌──────▼──────┐
          │   Load      │
          │  Balancer   │
          │   (ALB)     │
          └──────┬──────┘
                 │
```

### Translation Notes

- `actor User` implies authenticated client devices → Mobile/Web clients
- `actor Visitor` implies unauthenticated access → Public-facing pages cached at CDN
- `@slo(p99 < 100ms)` in system context → CDN + Load Balancer required for latency
- `region: us-primary, eu-secondary` → Multi-region load balancing, geo-routed DNS

### Interview Talking Points

> "I have three actors: `User` (authenticated, tiered), `Admin` (MFA), and `Visitor` (no auth). For the 100ms p99 SLA, I need a CDN in front of static assets and a load balancer routing to regional API endpoints."

---

## 2. Commands → API Endpoints / Services

### DSL

```text
user -> postTweet(content, media?)
on [user-authenticated(userId)]
  --[content.length > 280]--> [tweet-rejected]
  --[default]--> [tweet-created { ... }]

user -> followUser(targetUserId)
on [user-authenticated(userId), user-exists(targetUserId)]
  --[alreadyFollowing]--> [follow-rejected]
  --[default]--> [user-followed { ... }]
```

### Architecture

```
┌─────────────────────────────────────────┐
│           API Gateway                   │
│  ┌─────────────┐  ┌─────────────────┐  │
│  │ POST /tweets│  │ POST /follow    │  │
│  └──────┬──────┘  └────────┬────────┘  │
│         │                  │            │
│  ┌──────▼──────┐  ┌────────▼────────┐  │
│  │ Tweet       │  │ Social Graph    │  │
│  │ Service     │  │ Service         │  │
│  └──────┬──────┘  └────────┬────────┘  │
└─────────┼──────────────────┼───────────┘
          │                  │
          ▼                  ▼
```

### Translation Notes

- Each `actor -> command()` maps to an API endpoint
- Guards become request validation logic
- Emitted events become the response payload + audit log entry
- Service boundaries follow boundary boundaries: `postTweet` → Tweet Service, `followUser` → Social Graph Service

### Interview Talking Points

> "I have four main commands: `postTweet`, `followUser`, `likeTweet`, `retweet`. Each maps to a service endpoint. `postTweet` and `likeTweet` go to the Tweet Service. `followUser` goes to the Social Graph Service. The guard logic (content length, already following) is validated in the service before emitting events."

---

## 3. Boundaries → Data Stores / Partition Strategy

### DSL

```text
boundary TweetFeed(tweetId)
  @partition(shardKey="tweetId")
  @cost(readRpsPeak=100000, writeRpsPeak=1000)

boundary UserTimeline(userId)
  @partition(shardKey="userId")
  @cost(readRpsPeak=500000, writeRpsPeak=50000)
```

### Architecture

```
┌───────────────────────────────────────────┐
│          Tweet Service                    │
│  ┌─────────────────────────────────────┐  │
│  │  Tweet Feed Boundary                │  │
│  │  @partition(shardKey="tweetId")     │  │
│  │                                     │  │
│  │  ┌─────────┐ ┌─────────┐ ┌───────┐ │  │
│  │  │ Shard 1 │ │ Shard 2 │ │ Shard │ │  │
│  │  │ tweet:A │ │ tweet:B │ │  ...  │ │  │
│  │  └─────────┘ └─────────┘ └───────┘ │  │
│  └─────────────────────────────────────┘  │
└───────────────────────────────────────────┘
           │
           ▼
    ┌──────────────┐
    │  Cassandra   │
    │  (wide-row)  │
    └──────────────┘
```

### Translation Notes

- `@partition(shardKey="tweetId")` → Partition key in Cassandra/DynamoDB
- `@cost(readRpsPeak=100000)` → High read throughput → Wide-row store optimized for reads
- `TweetFeed` is write-seldom, read-often → Optimize for read path
- `UserTimeline` is read-heavy (500k RPS) → Materialized view + cache

### Interview Talking Points

> "TweetFeed boundary is partitioned by `tweetId`. With 100k read RPS and only 1k write RPS, this is a read-heavy workload. I'd use Cassandra with `tweetId` as partition key. Each tweet is a row, likes/retweets are clustering columns for range queries."

---

## 4. Views → Caches / Read Models

### DSL

```text
view UserTimeline(userId) = [
  user-followed*(userId, targetUserId),
  tweet-created*(targetUserId),
  tweet-retweeted*(targetUserId)
] => {
  tweetId, userId, content, media, createdAt,
  likes: count(tweet-liked*(tweetId)),
  retweets: count(tweet-retweeted*(tweetId))
} @bergcache(key="timeline:{userId}", ttl=5m)
  @cost(memory="~50MB/region", readRpsPeak=500000)
```

### Architecture

```
┌─────────────────────────────────────────┐
│          Timeline Service                │
│  ┌─────────────────────────────────────┐ │
│  │  UserTimeline View                  │ │
│ │  @bergcache(key="timeline:{userId}")│ │
│ │  ttl=5m                             │ │
│ │                                     │ │
│ │  ┌─────────┐    ┌─────────────┐    │ │
│ │  │ Redis   │    │  Cassandra  │    │ │
│ │  │ Cluster │    │  (events)   │    │ │
│ │  │ (cache) │    │             │    │ │
│ │  └─────────┘    └─────────────┘    │ │
│  └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
           ▲
           │
    ┌──────┴──────┐
    │  Projection │
    │  Worker     │
    │  (async)    │
    └─────────────┘
```

### Translation Notes

- `@bergcache` with `ttl=5m` → Redis cluster with 5-minute TTL
- `readRpsPeak=500000` → Distributed cache required (single Redis can't handle 500k RPS alone)
- `memory="~50MB/region"` → 3 regions × 50MB = 150MB total cache footprint
- Projection worker → Async process that rebuilds timeline from events when cache misses

### Interview Talking Points

> "The UserTimeline view is the hot path. 500k RPS reads means I need a distributed cache. I'll use Redis with `timeline:{userId}` keys, 5-minute TTL. The projection worker materializes the timeline from events: it follows the user's follow graph, pulls recent tweets from followed users, and caches the result. On cache miss, the worker rebuilds from events."

---

## 5. Policies → Async Workers / Message Queues

### DSL

```text
tweet-created { content, hashtags }
  --[count(tweet-created*(hashtag, window: 1h)) > 10000]--> trending-analyzer -> [
    trend-detected { hashtag, volume, window: "1h", detectedAt: clock.wall() }
  ]

tweet-liked { userId, tweetId }
  -> notification-worker -> sendLikeNotification(tweetId, userId)
```

### Architecture

```
┌───────────────────────────────────────────┐
│          Event Stream                     │
│  ┌─────────────────────────────────────┐  │
│ │  tweet-created                       │  │
│ │  tweet-liked                          │  │
│ │  user-followed                        │  │
│ └──────────────┬──────────────────────┘  │
│                │                         │
│  ┌─────────────▼──────────────────────┐  │
│  │  Kafka / EventBridge               │  │
│  └─────────────┬──────────────────────┘  │
│                │                         │
│    ┌───────────┼────────────┐            │
│    │           │            │            │
│    ▼           ▼            ▼            │
│  ┌─────┐   ┌─────┐   ┌──────────┐       │
│  │trend│   │notif│   │analytics │       │
│  │analy│   │worker│   │ worker   │       │
│  │zer  │   │     │   │          │       │
│  └─────┘   └─────┘   └──────────┘       │
└───────────────────────────────────────────┘
```

### Translation Notes

- `tweet-created -> trending-analyzer` → Kafka consumer group for trend analysis
- `tweet-liked -> notification-worker` → Separate consumer group for notifications
- Each policy is independently scalable
- Event stream is the backbone: all state changes flow through it

### Interview Talking Points

> "Policies are my async reactions. `tweet-created` triggers three downstream workers: trending analysis, notification dispatch, and analytics aggregation. I'd use Kafka consumer groups so each worker scales independently. If the notification worker is slow, it doesn't block trend analysis."

---

## 6. Putting It All Together: The Full Picture

### DSL Model (Summary)

```text
system TwitterAPI {
  external: stripe (payments), sentry (monitoring), cloudfront (cdn)
  slo: 99.95% uptime, p99 < 100ms
  region: us-primary, eu-secondary, ap-southeast
  data-classification: public, pii
}

actor User { auth: session, tier: free|pro|enterprise }
actor Admin { auth: oauth, mfa: required }
actor Visitor { auth: none }

// Commands
user -> postTweet(content, media?)
user -> followUser(targetUserId)
user -> likeTweet(tweetId)
user -> retweet(tweetId)
user -> deleteTweet(tweetId)

// Boundaries
boundary TweetFeed(tweetId) @partition(shardKey="tweetId")
boundary UserTimeline(userId) @partition(shardKey="userId")
boundary UserFollows(userId) @partition(shardKey="userId")

// Views
view UserTimeline(userId) @bergcache(key="timeline:{userId}", ttl=5m)
view TweetDetails(tweetId) @bergcache(key="tweet:{tweetId}", ttl=1h)
view UserProfile(userId) @bergcache(key="profile:{userId}", ttl=24h)

// Policies
tweet-created -> trending-analyzer -> calculateTrending()
user-followed -> notification-worker -> sendFollowNotification()
tweet-liked -> notification-worker -> sendLikeNotification()
```

### Full Architecture Diagram

```
┌─────────────┐     ┌─────────────┐
│   Mobile    │     │    Web      │
│   Client    │     │   Client    │
└──────┬──────┘     └──────┬──────┘
       │                   │
       └─────────┬─────────┘
                 │
          ┌──────▼──────┐
          │   CDN       │
          │ (CloudFront)│
          └──────┬──────┘
                 │
          ┌──────▼──────┐
          │   API GW    │
          │ (Kong/ALB)  │
          └──────┬──────┘
                 │
    ┌────────────┼────────────┐
    │            │            │
    ▼            ▼            ▼
┌────────┐  ┌────────┐  ┌──────────┐
│ Tweet  │  │ Social │  │  User    │
│ Service│  │ Graph  │  │ Service  │
│        │  │ Service│  │          │
└────┬───┘  └───┬────┘  └────┬─────┘
     │          │            │
     ▼          ▼            ▼
┌─────────────────────────────────────┐
│         Cassandra Cluster           │
│  ┌────────────┐ ┌───────────────┐  │
│  │ Tweet Feed │ │ User Follows  │  │
│  │ Shards     │ │ Shards        │  │
│  └────────────┘ └───────────────┘  │
└─────────────────────────────────────┘
     ▲          ▲            ▲
     │          │            │
┌────┴───┐  ┌───┴────┐  ┌───┴────┐
│ Redis  │  │ Redis  │  │ Redis  │
│ (TL)   │  │ (TD)   │  │ (UP)   │
│ Cache  │  │ Cache  │  │ Cache  │
└────────┘  └────────┘  └────────┘
     ▲          ▲            ▲
     │          │            │
     └──────────┼────────────┘
                │
         ┌──────▼──────┐
         │  Projection │
         │  Workers    │
         └──────┬──────┘
                │
         ┌──────▼──────┐
         │  Event      │
         │  Stream     │
         │  (Kafka)    │
         └──────┬──────┘
                │
    ┌───────────┼────────────┐
    │           │            │
    ▼           ▼            ▼
┌───────┐ ┌─────────┐ ┌──────────┐
│Trend  │ │Notif    │ │Analytics │
│Analyzer│ │Worker   │ │ Worker   │
└───────┘ └─────────┘ └──────────┘
```

### Translation Table

| DSL Primitive | Architecture Component | Technology Examples |
|---|---|---|
| `actor User` | Mobile/Web Client | iOS, Android, React |
| `system ... slo: p99 < 100ms` | CDN + Load Balancer | CloudFront, ALB |
| `user -> postTweet()` | API Endpoint / Service | REST/GraphQL, Tweet Service |
| `boundary TweetFeed(tweetId)` | Database Partition | Cassandra, DynamoDB |
| `view UserTimeline(userId) @bergcache` | Distributed Cache | Redis Cluster |
| `policy tweet-created -> trending-analyzer` | Async Worker + Message Queue | Kafka consumer, worker service |
| `on [user-authenticated(userId)]` | Auth Middleware | OAuth, JWT validation |

---

## Key Insights from This Translation

1. **The DSL forces you to name actors before infrastructure.** Without `actor User` and `actor Visitor`, you might forget to model public vs. authenticated access patterns.

2. **Boundaries dictate data stores.** `@partition(shardKey="tweetId")` + `@cost(readRpsPeak=100000)` immediately suggests Cassandra over PostgreSQL.

3. **Views are caches.** Every `@bergcache` annotation is a Redis (or similar) cache. The TTL and memory estimates tell you the cache strategy.

4. **Policies are async.** Every `event -> worker -> command()` is a Kafka consumer group or similar async processor. This keeps the write path fast.

5. **System context drives global decisions.** `@slo(p99 < 100ms)` + `region: multi-region` implies CDN, load balancer, and geo-routed DNS before you even draw a box.

---

## Exercises

1. Add a `user -> blockUser(targetUserId)` command. What new boundary/view/policy does this require?
2. Add media upload support. How does `postTweet` change? What storage does media imply?
3. Add DMs (direct messages). How is this different from public tweets in terms of boundaries and views?
4. Add search. Where does search fit in the event model? Is it a view, a policy, or something else?
