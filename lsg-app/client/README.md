# LSG Management Portal

A modern React.js application for network and remote management with a sleek, professional interface.

## Configuration

### API Configuration
The application uses a centralized API configuration system located in `src/config/api.js`. The base URL can be configured using environment variables:

```bash
# Default configuration (if no environment variable is set)
REACT_APP_API_URL=http://localhost:3001

# Production example
REACT_APP_API_URL=https://your-production-api.com

# Development with custom port
REACT_APP_API_URL=http://192.168.1.105:3001
```

Create a `.env.local` file in the client directory to override the default API URL:
```bash
REACT_APP_API_URL=http://your-custom-api-url:port
```

All API endpoints are centrally managed, making it easy to switch between development, staging, and production environments.

## Features

### 🎨 Modern Navigation
- **Top Navigation Bar**: Gradient-styled header with breadcrumbs, search, and user menu
- **Expandable Sidebar**: Collapsible navigation with sub-menus and status indicators
- **Dark/Light Mode**: Toggle between themes with automatic persistence
- **Responsive Design**: Mobile-friendly layout that adapts to different screen sizes

### 🔧 Core Management Features
- **Network Management**: Interface configuration, firewall rules, connectivity monitoring
- **Remote Management**: System time settings, restart scheduling, VPN management
- **Protocol Apps**: Real-time data collection and analytics
- **Data Forwarding**: Protocol configuration and data transmission

### 🎯 UI/UX Highlights
- **Material Design 3**: Latest Material-UI components with custom theming
- **Glass Morphism Effects**: Backdrop blur and transparency for modern aesthetics
- **Gradient Backgrounds**: Subtle gradients throughout the interface
- **Smart Breadcrumbs**: Context-aware navigation with icons
- **Status Indicators**: Real-time system status chips and badges
- **Interactive Animations**: Smooth transitions and hover effects

## Technology Stack

- **Frontend**: React 18, Material-UI 5, React Router 6
- **Styling**: Emotion CSS-in-JS, Google Fonts (Inter)
- **State Management**: React Context API
- **Date/Time**: MUI X Date Pickers with date-fns
- **Icons**: Material Design Icons

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm start

# Build for production
npm run build
```

## Theme Customization

The application includes a comprehensive theming system:

- **Color Palette**: Primary blues with accent colors
- **Typography**: Inter font family with various weights
- **Component Overrides**: Custom Material-UI component styling
- **Dark/Light Mode**: Automatic theme switching with persistence

## Navigation Structure

- **Overview**: System dashboard and metrics
- **Network Management**
  - Interfaces: Network interface configuration
  - Firewall: Security rules and policies
  - Connectivity: Connection status and monitoring
- **Remote Management**
  - Time Settings: System time and timezone configuration
  - System Restart: Scheduled and immediate restart options
  - VPN Management: VPN configuration and status
- **Protocol Apps**: Data collection management
- **Data Forwarding**: Data transmission protocols

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Development

This project uses Create React App. For more information about available scripts and configuration, see the [Create React App documentation](https://facebook.github.io/create-react-app/).
