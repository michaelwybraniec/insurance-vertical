import { createRoot } from 'react-dom/client';
import { installMockApi } from './mock-api';
import '../../../web/src/index.css';
import App from '../../../web/src/App';
import './demo-banner.css';

installMockApi();

function DemoShell() {
  const base = import.meta.env.BASE_URL;
  return (
    <>
      <div className="static-demo-banner" role="status">
        <strong>Static demo</strong>
        <span>
          In-browser mock — no API, Postgres, or worker. Use <strong>Run guided tour</strong> at the
          bottom for enrol → Architecture play → log details. Base <code>{base}</code>
        </span>
      </div>
      <App />
    </>
  );
}

createRoot(document.getElementById('root')!).render(<DemoShell />);
