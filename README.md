# NatureMap

A high-performance biodiversity mapping project.

## Deployment to GitHub Pages

This project is set up for automatic deployment to GitHub Pages using GitHub Actions.

### Setup Instructions

1.  Push your code to the `main` branch of your GitHub repository.
2.  Enable GitHub Pages in your repository settings:
    *   Go to **Settings** > **Pages**.
    *   Under **Build and deployment** > **Source**, select **GitHub Actions**.
3.  The workflow defined in `.github/workflows/deploy.yml` will automatically build and deploy the app every time you push to the `main` branch.

### Local Development

1.  Install dependencies:
    ```bash
    npm install
    ```
2.  Run the development server:
    ```bash
    npm run dev
    ```
3.  Build for production:
    ```bash
    npm run build
    ```
