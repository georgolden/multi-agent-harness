# PocketFlow-Template-Typescript

A TypeScript template for creating PocketFlow applications.

## Features

- TypeScript configuration
- ESLint and Prettier setup
- Vitest testing framework
- Basic project structure
- Example utility functions and types

## Getting Started

### Development

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run development mode with watch
npm run dev

# Run tests
npm test

# Lint code
npm run lint
```

## Project Structure

```
.
├── src/
│   ├── index.ts        # Main entry point
│   ├── types.ts        # Type definitions
│   ├── nodes.ts        # Node definitions
│   ├── flow.ts         # Flow related functionality
│   └── utils/          # Utility functions
│       └── callLlm.ts  # LLM API integration
├── docs/               # Documentation
│   └── design.md       # Design documentation
├── dist/               # Compiled output
├── tsup.config.ts      # Build configuration
├── eslint.config.mjs   # ESLint configuration
├── vitest.config.ts    # Vitest configuration
├── package.json        # Project dependencies and scripts
├── tsconfig.json       # TypeScript configuration
├── .env.example        # Example environment variables
└── README.md           # Project documentation
```

## Customizing the Template

You can customize this template to fit your specific needs by:

1. Modifying the TypeScript configuration in `tsconfig.json`
2. Updating ESLint rules in `eslint.config.mjs`
3. Configuring the build process in `tsup.config.ts`
4. Adding more dependencies to `package.json`
5. Setting up environment variables using `.env` (see `.env.example`)

## License

MIT
