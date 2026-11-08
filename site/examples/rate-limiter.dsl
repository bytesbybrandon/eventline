// 0. Actors & System Context
system RateLimiterAPI {
  external: stripe (payment-gateway), sentry (monitoring)
  slo: 99.99% uptime, p99 < 2ms
  region: us-primary, eu-secondary
  data-classification: pii
}

actor User { auth: session, tier: free|pro }
actor Admin { auth: oauth, mfa: required }
actor Visitor { auth: none }

// 1. Concurrency Boundary
boundary UserRateLimit(userId, currentMinute)
  @partition(shardKey="userId")
  @time(window="fixed:1m", source="clock.wall", clockSkewBudget="<250ms")
  @cost(regions=3, shardFanout=100000, writeRpsPeak=50000)
  @ops(owner="traffic-platform", slo="99.99%", alert="rate-limit-shard-unavailable")

// 2. Authentication Decider
user -> authenticate(email, password, ip)
on [user-created(email)]
  --[invalidCredentials]--> [
    user-auth-failed { email, ip, reason: "bad_password" }
  ]
  --[default]--> [
    user-auth-succeeded { userId, ip, tierId }
  ]

// 3. Tier Limit Projection
view TierLimit(tierId) = [
  tier-created(tierId),
  tier-limit-increased*(tierId),
  tier-limit-decreased*(tierId)
] => {
  tierId,
  limit
} @cache(key="tier:{tierId}:limit", ttl=24h)

// 4. Rate Limiter Decider
user -> makeRequest(resourceId) in UserRateLimit(userId, currentMinute)
on [
  user-auth-succeeded(userId, tierId),
  request-logged*(userId, window: currentMinute)
]
from [
  TierLimit(tierId) @fresh<24h> as tierLimit
]
  --[!canAccessResource]--> [
    request-failed { userId, resourceId, reason: "unauthorized" }
  ]
  --[count(request-logged) >= tierLimit.limit]--> [
    rate-limit-reached { userId, resourceId, retryAfter: 60s }
  ]
  --[default]--> [
    request-logged {
      userId,
      resourceId,
      requestMinute: currentMinute,
      requestAt: clock.wall()
    }
  ]

// 5. In-Memory Read View (O(1) in memory)
view UserQuota(userId) = [user-auth-succeeded(userId), request-logged*(userId)] => {
  tierId,
  remainingRequests,
  resetsIn
} @cache(key="quota:{userId}", ttl=60s)
  @cost(memory="~6MB/region", readRpsPeak=50000)
  @ops(owner="edge-runtime", dashboard="quota-window-overview")

// 6. Abuse Defense Policy (Decoupled from hot path)
rate-limit-reached { userId }
--[violationsLastHour > 50]--> waf-bot -> applyTemporaryBan(userId, duration=15m)

// 7. Stale-read fallback with confidence metadata
unavailable-shard-request-received { userId, shardId }
  --[staleCacheExists]--> [
    request-logged {
      userId,
      requestMinute: currentMinute,
      requestAt: clock.wall()
    } @confidence(level="low", reason="stale_quota", asOf=cache.timestamp)
  ]
