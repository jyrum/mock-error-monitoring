import 'dotenv/config';
import * as Sentry from '@sentry/node';
import express, { Request, Response, NextFunction } from 'express';

// --- Sentry setup -----------------------------------------------------
// Because GlitchTip and Bugsink both speak the Sentry protocol, switching
// between them is just a matter of changing SENTRY_DSN in .env.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT || 'local',
  release: process.env.SENTRY_RELEASE || 'buggy-task-tracker-ts@1.0.0',
  tracesSampleRate: 1.0,
});

Sentry.setTag('app_name', 'buggy-task-tracker');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// --- Custom errors ------------------------------------------------------

class DatabaseConnectionError extends Error {
  constructor(message = 'Failed to connect to the database') {
    super(message);
    this.name = 'DatabaseConnectionError';
  }
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// --- In-memory "database" ------------------------------------------------

interface Task {
  id: number;
  title: string;
}

const tasks: Task[] = [
  { id: 1, title: 'Buy milk' },
  { id: 2, title: 'Write Sentry comparison notes' },
  { id: 3, title: 'Fix the bug that does not exist' },
];
let nextId = tasks.length + 1;

// --- Helper: tag every request with a route name for Sentry ------------

function tagRoute(routeName: string, testType: string) {
  Sentry.setTag('route', routeName);
  Sentry.setTag('test_type', testType);
}

// --- Routes ---------------------------------------------------------------

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', app: 'buggy-task-tracker', uptime: process.uptime() });
});

app.get('/tasks', (_req: Request, res: Response) => {
  tagRoute('/tasks', 'happy_path');
  Sentry.addBreadcrumb({
    category: 'task',
    message: 'Listed all tasks',
    level: 'info',
    data: { count: tasks.length },
  });
  res.json({ tasks });
});

app.post('/tasks', (req: Request, res: Response) => {
  tagRoute('/tasks', 'happy_path');
  const { title } = req.body ?? {};

  if (!title || typeof title !== 'string') {
    const error = new ValidationError('Task title is required and must be a string');
    Sentry.captureException(error);
    return res.status(400).json({ error: error.message });
  }

  const task: Task = { id: nextId++, title };
  tasks.push(task);

  Sentry.addBreadcrumb({
    category: 'task',
    message: 'Created a new task',
    level: 'info',
    data: { taskId: task.id, title: task.title },
  });

  res.status(201).json({ task });
});

// GET /crash - intentionally unhandled exception
app.get('/crash', (_req: Request, _res: Response) => {
  tagRoute('/crash', 'unhandled_exception');
  throw new Error('Intentional crash: unhandled exception for testing');
});

// GET /handled-error - manually captured error
app.get('/handled-error', (_req: Request, res: Response) => {
  tagRoute('/handled-error', 'handled_exception');
  try {
    throw new Error('Intentional handled error for testing');
  } catch (error) {
    Sentry.captureException(error);
    res.json({ message: 'Handled error was reported to Sentry' });
  }
});

// GET /validation-error - simulated validation failure
app.get('/validation-error', (req: Request, res: Response) => {
  tagRoute('/validation-error', 'validation_error');
  const title = req.query.title;

  if (!title || typeof title !== 'string') {
    const error = new ValidationError('Missing or invalid "title" query parameter');
    Sentry.captureException(error);
    return res.status(400).json({ error: error.message });
  }

  res.json({ message: `Task title "${title}" is valid` });
});

// GET /db-error - simulated database connection failure
app.get('/db-error', (_req: Request, _res: Response) => {
  tagRoute('/db-error', 'database_error');
  throw new DatabaseConnectionError('Simulated failure: could not reach the task database');
});

// GET /external-api-error - simulated third-party API failure with breadcrumb
app.get('/external-api-error', (_req: Request, _res: Response) => {
  tagRoute('/external-api-error', 'external_api_error');

  Sentry.addBreadcrumb({
    category: 'external-api',
    message: 'Calling third-party task-sync API',
    level: 'info',
    data: { url: 'https://example-task-sync.invalid/api/v1/sync' },
  });

  throw new Error('Simulated failure: external API request to task-sync service failed');
});

// GET /user-context-error - error thrown with fake user context attached
app.get('/user-context-error', (_req: Request, _res: Response) => {
  tagRoute('/user-context-error', 'user_context_error');

  Sentry.setUser({
    id: '42',
    email: 'jane.doe@example.com',
    username: 'jane.doe',
    role: 'admin',
    organization: 'Acme Corp',
  });

  throw new Error('Simulated failure: something went wrong for this user');
});

// GET /background-job-error - error thrown outside the request/response cycle
function runBackgroundJob() {
  try {
    throw new Error('Simulated failure: background job failed to process task queue');
  } catch (error) {
    Sentry.setTag('route', '/background-job-error');
    Sentry.setTag('test_type', 'background_job_error');
    Sentry.addBreadcrumb({
      category: 'background-job',
      message: 'Background job started processing task queue',
      level: 'info',
    });
    Sentry.captureException(error);
  }
}

app.get('/background-job-error', (_req: Request, res: Response) => {
  tagRoute('/background-job-error', 'background_job_error');
  setTimeout(runBackgroundJob, 100);
  res.json({ message: 'Background job scheduled; it will fail asynchronously and report to Sentry' });
});

// --- Sentry error handler -------------------------------------------------
// Must be registered after all routes but before any custom error middleware.
Sentry.setupExpressErrorHandler(app);

// --- Custom JSON error middleware -----------------------------------------
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({
    error: err.name || 'InternalServerError',
    message: err.message,
    sentryEventId: (res as any).sentry,
  });
});

app.listen(PORT, () => {
  console.log(`Buggy Task Tracker listening on http://localhost:${PORT}`);
  console.log(`Sentry environment: ${process.env.SENTRY_ENVIRONMENT || 'local'}`);
});
