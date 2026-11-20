system Shop {
  external: stripe (payment)
  region: eu, us, ap
}

actor User { auth: session }

boundary Cart(cartId) @partition(shardKey="cartId") @cost(regions=1) @link(label="nowhere")
boundary Order(orderId) @link(url="https://wiki.example.com/order")

event item-added { cartId, sku }
event cart-abandoned

context Sales {
  description: Carts and orders
  publishes: order-placed

  user -> addItem(cartId, sku) in Cart(cartId) @link(to="eventmodel", node="view:CartView")
    @trigger(type=ui, name="CartScreen", route="POST /carts/{cartId}/items")
    -[default]-> [item-added { cartId, sku }]
    scenario "adds an item" {
      Given an empty cart
      When the user adds an item
      Then the cart has one item
    }

  user -> placeOrder(cartId, orderId) in Order(orderId)
    on [item-added(cartId)]
    from [CartView(cartId) @fresh<5s> as cart]
    --[cart.empty]--> reject CART_EMPTY
    --[default]--> [order-placed { cartId, orderId }]
}

context Shipping {
  stripe-webhook -> capture(orderId, amount) in Order(orderId)
    on [order-placed(orderId)]
    --[default]--> [payment-captured { orderId, amount }]
}

view CartView(cartId) = [item-added*(cartId)] => { items: count(item-added*(cartId)) } @link(to="containers", node="api") @link(url="ftp-ish")
readmodel OrdersToShip(orderId) = [order-placed(orderId), payment-captured(orderId)] => { orderId }
view Activity(cartId) = [item-added(cartId), order-placed(cartId)] => { n }

order-placed { orderId } -> fulfilment-worker -> ship(orderId)
payment-captured from [OrdersToShip] -> fulfilment-worker -> ship(orderId)
from [OrdersToShip] --[ready]--> packer -> pack(orderId)
item-added { cartId } @planned
  --[sku == "gift"]--> gift-worker -> [gift-wrapped { cartId }]
policy Notify = order-placed { orderId } @link(to="nonsense")
  -[default]-> notifier -> notify(orderId)
every 5 minutes
from [CartView(cartId)]
  -> sweeper -> [cart-abandoned { cartId }]
cron "0 * * * *" @link(to="dataflow", node="cmd:nope")
  -> reporter -> report()
readmodel from [CartView] -> lister -> list(cartId)
