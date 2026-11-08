# eventline

Every system is a series of events.
eventline is a small notation for describing one: commands, events, views and policies, built on [Event Modeling](https://eventmodeling.org) and Dynamic Consistency Boundaries.
`eventline-axi` reads a model, checks it and draws it.

Live site and demos: https://bytesbybrandon.github.io/eventline/

## A decision in six lines

```text
user -> postTweet(content, media?) in UserTimeline(userId)
on [user-authenticated(userId)]
  --[content.length > 280]--> [tweet-rejected]
  --[default]--> [
    tweet-created { userId, content, media, createdAt: clock.wall() }
  ]
```

A command is what someone asks for.
`on [...]` lists the facts it needs.
Each `--[guard]-->` line is a branch, and `default` is the happy path.
`in UserTimeline(userId)` names the consistency boundary the decision runs in.
Events are what happened, and they are all that is stored.

## Try it

```bash
npx -y eventline-axi --help
```

The CLI reads a `.dsl` file, so start with one of the examples.
From a clone of this repo:

```bash
npm install
node bin/eventline-axi examples/twitter-pure.dsl
```

Without a clone, download the example from the site:

```bash
curl -O https://bytesbybrandon.github.io/eventline/twitter-pure.dsl
npx -y eventline-axi twitter-pure.dsl
```

## What you can do with a model

| Goal | Command |
| :--- | :--- |
| See what is in it | `eventline-axi commands|events|views|policies <file>` |
| Find mistakes | `eventline-axi validate <file>` |
| See what depends on what | `eventline-axi deps <file> <name>` |
| Draw it | `eventline-axi diagram eventmodel <file> -o board.svg` |
| Draw everything | `eventline-axi diagrams <file> -o diagrams` |

Diagram types, formats and what each one is derived from are in [EVENTLINE-AXI.md](./EVENTLINE-AXI.md).

## Learn the notation

- [The documentation site](https://bytesbybrandon.github.io/eventline/docs/) has all of this with search.
- [docs/README.md](./docs/README.md) is the map: which document to read first for your goal.
- [docs/LANGUAGE.md](./docs/LANGUAGE.md) is the full reference.
- [docs/EXAMPLES.md](./docs/EXAMPLES.md) has two worked models, a rate limiter and a payment webhook.
- [docs/GLOSSARY.md](./docs/GLOSSARY.md) defines every term.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT. See [LICENSE](./LICENSE).
