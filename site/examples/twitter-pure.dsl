system TwitterAPI {
  external: stripe (payments), sentry (monitoring), cloudfront (cdn)
  slo: 99.95% uptime, p99 < 100ms
  region: us-primary, eu-secondary, ap-southeast
  data-classification: public, pii
}

actor User { auth: session, tier: free|pro|enterprise }
actor Admin { auth: oauth, mfa: required }
actor Visitor { auth: none }

boundary TweetFeed(tweetId) @partition(shardKey="tweetId")
boundary UserTimeline(userId) @partition(shardKey="userId")
boundary UserFollows(userId) @partition(shardKey="userId")

view UserTimeline(userId) = [
  user-followed*(userId, targetUserId),
  tweet-created*(targetUserId),
  tweet-retweeted*(targetUserId)
] => {
  tweetId, userId, content, media, createdAt,
  likes: count(tweet-liked*(tweetId)),
  retweets: count(tweet-retweeted*(tweetId))
} @bergcache(key="timeline:{userId}", ttl=5m)

view TweetDetails(tweetId) = [tweet-created(tweetId)] => {
  content, media, createdAt, likes, retweets
} @bergcache(key="tweet:{tweetId}", ttl=1h)

view UserProfile(userId) = [user-created(userId), user-updated*(userId)] => {
  name, handle, bio, followers, following
} @bergcache(key="profile:{userId}", ttl=24h)

user -> postTweet(content, media?) in UserTimeline(userId)
on [user-authenticated(userId)]
  --[content.length > 280]--> [tweet-rejected]
  --[default]--> [
    tweet-created { userId, content, media, createdAt: clock.wall() }
  ]

user -> followUser(targetUserId) in UserFollows(userId)
on [user-authenticated(userId), user-exists(targetUserId)]
  --[alreadyFollowing]--> [follow-rejected]
  --[default]--> [
    user-followed { userId, targetUserId, followedAt: clock.wall() }
  ]

user -> likeTweet(tweetId) in TweetFeed(tweetId)
on [user-authenticated(userId), tweet-exists(tweetId)]
  --[alreadyLiked]--> [like-rejected]
  --[default]--> [
    tweet-liked { userId, tweetId, likedAt: clock.wall() }
  ]

user -> retweet(tweetId) in TweetFeed(tweetId)
on [user-authenticated(userId), tweet-exists(tweetId)]
  --[alreadyRetweeted]--> [retweet-rejected]
  --[default]--> [
    tweet-retweeted { userId, tweetId, retweetedAt: clock.wall() }
  ]

user -> deleteTweet(tweetId) in TweetFeed(tweetId)
on [user-authenticated(userId), tweet-created(tweetId, userId)]
  --[!isOwner]--> [delete-rejected]
  --[default]--> [
    tweet-deleted { tweetId, deletedAt: clock.wall() }
  ]

tweet-created { content, hashtags }
  --[count(tweet-created*(hashtag, window: 1h)) > 10000]--> trending-analyzer -> [
    trend-detected { hashtag, volume, window: "1h", detectedAt: clock.wall() }
  ]

tweet-liked { userId, tweetId }
  -> notification-worker -> sendLikeNotification(tweetId, userId)
