import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import { API_BASE_URL } from '../config';
import {
  Alert,
  Badge,
  Button,
  Container,
  Form,
  Modal,
  Table,
} from 'react-bootstrap';

const SERVICE_ACCOUNT_EMAIL = import.meta.env.VITE_SERVICE_ACCOUNT_EMAIL;

const emptyUploadActivity = {
  name: '',
  title: '',
  sheet_url: '',
  order_index: '',
};

function slugifyActivityName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);
}

function extractTitleFromMarkup(text) {
  const match = String(text || '').match(/^\\title\{([^}]*)\}/m);
  return match ? match[1].trim() : null;
}

function SourceBadge({ sourceType }) {
  const normalized = String(sourceType || 'remote').toLowerCase();
  const isLocal = normalized === 'local';

  return (
    <Badge bg={isLocal ? 'success' : 'secondary'}>
      {isLocal ? 'Local' : 'Remote'}
    </Badge>
  );
}

export default function ManageActivitiesPage() {
  const { id: classId } = useParams();
  const { user } = useUser();
  const navigate = useNavigate();
  const location = useLocation();

  const [activities, setActivities] = useState([]);
  const [newActivity, setNewActivity] = useState(emptyUploadActivity);
  const [pendingActivity, setPendingActivity] = useState(null);

  const [showShareModal, setShowShareModal] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showDownloadModal, setShowDownloadModal] = useState(false);

  const [folderUrl, setFolderUrl] = useState('');
  const [uploadMode, setUploadMode] = useState('file');
  const [downloadSelection, setDownloadSelection] = useState({});
  const [downloadFolderUrl, setDownloadFolderUrl] = useState('');
  const [selectedUploadFile, setSelectedUploadFile] = useState(null);
  const [uploadNote, setUploadNote] = useState('');

  const canManage = user?.role === 'root' || user?.role === 'creator';

  const refreshActivities = async () => {
    const res = await fetch(`${API_BASE_URL}/api/classes/${classId}/activities`, {
      credentials: 'include',
    });
    const data = await res.json();
    if (Array.isArray(data)) {
      setActivities(data);
    } else {
      console.error('Unexpected response format:', data);
    }
  };

  useEffect(() => {
    if (!canManage) {
      navigate('/dashboard');
      return;
    }

    refreshActivities().catch((err) => {
      console.error('Fetch error:', err);
    });
  }, [canManage, classId, navigate]);

  useEffect(() => {
    const nextSelection = {};
    for (const activity of activities) {
      nextSelection[activity.id] = downloadSelection[activity.id] ?? false;
    }
    setDownloadSelection(nextSelection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activities]);

  const selectedDownloadCount = useMemo(
    () => Object.values(downloadSelection).filter(Boolean).length,
    [downloadSelection]
  );

  const handleFieldChange = (name, field, value) => {
    setActivities((prev) =>
      prev.map((activity) =>
        activity.name === name ? { ...activity, [field]: value } : activity
      )
    );
  };

  const handleUploadFieldChange = (e) => {
    setNewActivity((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const resetUploadState = () => {
    setNewActivity(emptyUploadActivity);
    setPendingActivity(null);
    setSelectedUploadFile(null);
    setUploadNote('');
    setShowUploadModal(false);
    setShowShareModal(false);
  };

  const saveActivity = async (activity) => {
    const res = await fetch(`${API_BASE_URL}/api/classes/${classId}/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(activity),
      credentials: 'include',
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || 'Add failed.');
      return;
    }

    const newId = data?.id;
    resetUploadState();

    if (newId && activity?.sheet_url && activity.sheet_url.trim() !== '') {
      navigate(`/preview/${newId}?returnTo=${encodeURIComponent(location.pathname)}`);
      return;
    }

    await refreshActivities();
  };

  const handleUpload = async () => {
    setUploadNote('');

    if (uploadMode === 'file') {
      if (!selectedUploadFile) {
        setUploadNote('Choose a local text file or JSON bundle first.');
        return;
      }

      try {
        const raw = await selectedUploadFile.text();
        const filename = selectedUploadFile.name || 'activity.txt';
        const fileBase = filename.replace(/\.[^.]+$/, '');

        if (/\.json$/i.test(filename)) {
          const parsed = JSON.parse(raw);
          const importedItems = Array.isArray(parsed?.activities)
            ? parsed.activities
            : Array.isArray(parsed)
              ? parsed
              : [parsed];

          if (!importedItems.length) {
            setUploadNote('That JSON file did not contain any activities.');
            return;
          }

          for (let index = 0; index < importedItems.length; index += 1) {
            const item = importedItems[index] || {};
            const contentText = String(item.content_text || item.text || '');
            const title = item.title || extractTitleFromMarkup(contentText) || `Imported Activity ${index + 1}`;
            const name = slugifyActivityName(item.name || title || `${fileBase}_${index + 1}`) || `activity_${Date.now()}_${index + 1}`;

            await saveActivity({
              name,
              title,
              source_type: 'local',
              content_text: contentText,
              order_index: item.order_index ?? activities.length + index,
              createdBy: user?.id,
            });
          }

          return;
        }

        const title = extractTitleFromMarkup(raw) || newActivity.title || fileBase;
        const name = slugifyActivityName(newActivity.name || title || fileBase) || `activity_${Date.now()}`;

        await saveActivity({
          name,
          title,
          source_type: 'local',
          content_text: raw,
          order_index: newActivity.order_index === '' ? activities.length : parseInt(newActivity.order_index, 10),
          createdBy: user?.id,
        });
      } catch (err) {
        console.error('Local upload failed:', err);
        setUploadNote('Unable to read that file. Use a plain text activity file or a JSON bundle.');
      }
      return;
    }

    const activity = {
      ...newActivity,
      order_index:
        newActivity.order_index === '' ? 0 : parseInt(newActivity.order_index, 10),
      createdBy: user?.id,
    };

    if (!activity.name || !activity.title) {
      alert('Please enter an activity ID and title.');
      return;
    }

    if (!activity.sheet_url || activity.sheet_url.trim() === '') {
      alert('Please enter a Google Sheet or Doc URL, or switch to file upload once it is available.');
      return;
    }

    setPendingActivity(activity);
    setShowUploadModal(false);
    setShowShareModal(true);
  };

  const confirmShareAndCheckAccess = async () => {
    setShowShareModal(false);

    if (!pendingActivity?.sheet_url) {
      await saveActivity(pendingActivity);
      setPendingActivity(null);
      return;
    }

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/activities/check-access?url=${encodeURIComponent(pendingActivity.sheet_url)}`
      );

      let result = { access: false };
      if (res.ok) {
        const text = await res.text();
        if (text) result = JSON.parse(text);
      }

      if (res.ok && result.access) {
        await saveActivity(pendingActivity);
      } else {
        alert('Access denied or document not found. Please ensure the document is shared and the URL is correct.');
        setNewActivity(pendingActivity);
        setShowUploadModal(true);
      }
    } catch (err) {
      console.error('Error checking access:', err);
      alert('Error checking document access. Please try again.');
      setNewActivity(pendingActivity);
      setShowUploadModal(true);
    }

    setPendingActivity(null);
  };

  const handleBulkImport = async () => {
    setShowFolderModal(false);
    const res = await fetch(`${API_BASE_URL}/api/classes/${classId}/import-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderUrl, createdBy: user.id }),
    });
    const data = await res.json();
    if (res.ok) {
      setActivities((prev) => [...prev, ...data.imported]);
      setFolderUrl('');
    } else {
      alert(data.error || 'Folder import failed.');
    }
  };

  const handleDelete = async (activityId) => {
    const res = await fetch(`${API_BASE_URL}/api/classes/${classId}/activities/${activityId}`, {
      method: 'DELETE',
    });

    if (res.ok) {
      setActivities((prev) => prev.filter((activity) => activity.id !== activityId));
    } else {
      const data = await res.json();
      alert(data.error || 'Delete failed.');
    }
  };

  const handleUpdate = async (activity) => {
    const payload = {
      title: activity.title,
      sheet_url: activity.sheet_url,
      order_index: parseInt(activity.order_index, 10),
    };

    const res = await fetch(`${API_BASE_URL}/api/classes/${classId}/activities/${activity.name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const updated = await res.json();
      setActivities((prev) =>
        prev.map((activityRow) =>
          activityRow.name === updated.name ? { ...activityRow, ...updated } : activityRow
        )
      );
    } else {
      const err = await res.text();
      console.error('Update failed:', err);
      alert('Update failed.');
    }
  };

  const openCreatePlaceholder = () => {
    alert('Create Activity is the next step. We will wire this button into the new authoring flow.');
  };

  const openDownloadPlaceholder = () => {
    setShowDownloadModal(true);
  };

  const triggerBrowserDownload = (filename, text, mimeType = 'text/plain;charset=utf-8') => {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadSelected = async () => {
    const selectedActivities = activities.filter((activity) => downloadSelection[activity.id]);
    if (!selectedActivities.length) {
      alert('Select at least one activity to download.');
      return;
    }

    try {
      const bundle = [];
      for (const activity of selectedActivities) {
        const res = await fetch(`${API_BASE_URL}/api/activities/${activity.id}/source`, {
          credentials: 'include',
        });
        const body = await res.json();
        if (!res.ok) {
          throw new Error(body?.error || `Failed to load activity ${activity.title}`);
        }

        bundle.push({
          id: activity.id,
          name: activity.name,
          title: activity.title,
          source_type: body.source_type || activity.source_type || 'remote',
          sheet_url: activity.sheet_url || null,
          order_index: activity.order_index,
          content_text: body.text || '',
        });
      }

      if (bundle.length === 1) {
        const item = bundle[0];
        const filename = `${slugifyActivityName(item.name || item.title || 'activity') || 'activity'}.txt`;
        triggerBrowserDownload(filename, item.content_text || '', 'text/plain;charset=utf-8');
      } else {
        const exportPayload = {
          format: 'colearn-activity-bundle/v1',
          class_id: Number(classId),
          exported_at: new Date().toISOString(),
          activities: bundle,
        };
        triggerBrowserDownload(
          `class_${classId}_activities.json`,
          JSON.stringify(exportPayload, null, 2),
          'application/json;charset=utf-8'
        );
      }
    } catch (err) {
      console.error('Download failed:', err);
      alert(err?.message || 'Failed to download selected activities.');
    }
  };

  return (
    <Container>
      <h2 className="mb-4">Manage POGIL Activities for Class {classId}</h2>

      <h4>Current Activities</h4>
      <Table striped bordered hover responsive className="mb-4">
        <thead>
          <tr>
            <th>Name</th>
            <th>Title</th>
            <th>Source</th>
            <th>Sheet URL</th>
            <th>Order</th>
            <th style={{ width: '30%' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {activities.map((activity) => (
            <tr key={activity.name}>
              <td>
                <Form.Control value={activity.name} readOnly />
              </td>
              <td>
                <Form.Control
                  value={activity.title}
                  onChange={(e) => handleFieldChange(activity.name, 'title', e.target.value)}
                />
              </td>
              <td className="align-middle text-center">
                <SourceBadge sourceType={activity.source_type} />
              </td>
              <td>
                <Form.Control
                  value={activity.sheet_url || ''}
                  onChange={(e) => handleFieldChange(activity.name, 'sheet_url', e.target.value)}
                />
              </td>
              <td>
                <Form.Control
                  type="number"
                  value={activity.order_index}
                  onChange={(e) =>
                    handleFieldChange(activity.name, 'order_index', parseInt(e.target.value, 10))
                  }
                />
              </td>
              <td className="align-middle">
                <div className="d-flex flex-wrap gap-2">
                  <Button
                    variant="success"
                    size="sm"
                    onClick={() => handleUpdate(activity)}
                  >
                    Update
                  </Button>
                  <Button
                    variant="info"
                    size="sm"
                    onClick={() => navigate(`/preview/${activity.id}?returnTo=${encodeURIComponent(location.pathname)}`)}
                  >
                    Preview
                  </Button>
                  <Button
                    variant="warning"
                    size="sm"
                    onClick={() => navigate(`/editor/${activity.id}`)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleDelete(activity.id)}
                  >
                    Delete
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

      <div className="d-flex flex-wrap gap-2 align-items-center mb-4">
        <Button variant="success" onClick={openCreatePlaceholder}>
          Create
        </Button>
        <Button variant="primary" onClick={() => setShowUploadModal(true)}>
          Upload
        </Button>
        <Button variant="secondary" onClick={openDownloadPlaceholder}>
          Download
        </Button>
      </div>

      <Modal show={showUploadModal} onHide={() => setShowUploadModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Upload Activity</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group className="mb-3">
            <Form.Label>Upload Type</Form.Label>
            <Form.Select value={uploadMode} onChange={(e) => setUploadMode(e.target.value)}>
              <option value="file">Single text file or JSON bundle</option>
              <option value="google">Google Doc or Sheet URL</option>
            </Form.Select>
          </Form.Group>

          {uploadMode === 'google' ? (
            <>
              <Form.Group className="mb-2">
                <Form.Control
                  name="name"
                  placeholder="Activity ID"
                  value={newActivity.name}
                  onChange={handleUploadFieldChange}
                />
              </Form.Group>
              <Form.Group className="mb-2">
                <Form.Control
                  name="title"
                  placeholder="Title"
                  value={newActivity.title}
                  onChange={handleUploadFieldChange}
                />
              </Form.Group>
              <Form.Group className="mb-2">
                <Form.Control
                  name="sheet_url"
                  placeholder="Google Sheet or Doc URL"
                  value={newActivity.sheet_url}
                  onChange={handleUploadFieldChange}
                />
              </Form.Group>
              <Form.Group>
                <Form.Control
                  name="order_index"
                  type="number"
                  placeholder="Order Index"
                  value={newActivity.order_index}
                  onChange={handleUploadFieldChange}
                />
              </Form.Group>
            </>
          ) : (
            <>
              <Form.Group className="mb-3">
                <Form.Label>Choose Local File</Form.Label>
                <Form.Control
                  type="file"
                  accept=".txt,.md,.tex,.json,.zip"
                  onChange={(e) => setSelectedUploadFile(e.target.files?.[0] || null)}
                />
                <div className="text-muted small mt-2">
                  Upload a single activity text file now, or a JSON activity bundle. Zip support is next.
                </div>
              </Form.Group>
              <Form.Group className="mb-2">
                <Form.Control
                  name="name"
                  placeholder="Optional Activity ID override"
                  value={newActivity.name}
                  onChange={handleUploadFieldChange}
                />
              </Form.Group>
              <Form.Group>
                <Form.Control
                  name="order_index"
                  type="number"
                  placeholder="Optional Order Index"
                  value={newActivity.order_index}
                  onChange={handleUploadFieldChange}
                />
              </Form.Group>
            </>
          )}
          {uploadNote ? (
            <Alert variant="warning" className="mt-3 mb-0">
              {uploadNote}
            </Alert>
          ) : null}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowUploadModal(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleUpload}>
            {uploadMode === 'file' ? 'Upload from Drive' : 'Continue'}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={showFolderModal} onHide={() => setShowFolderModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Import from Google Folder</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Control
            type="text"
            placeholder="Enter Google Drive folder URL"
            value={folderUrl}
            onChange={(e) => setFolderUrl(e.target.value)}
          />
          <p className="mt-2">
            Make sure the folder is shared with: <code>{SERVICE_ACCOUNT_EMAIL}</code>
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowFolderModal(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleBulkImport}>
            Import
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={showDownloadModal} onHide={() => setShowDownloadModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Download Activities</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group className="mb-3">
            <Form.Label>Activity Selection</Form.Label>
            <div className="border rounded p-3" style={{ maxHeight: '260px', overflowY: 'auto' }}>
              {activities.map((activity) => (
                <Form.Check
                  key={activity.id}
                  type="checkbox"
                  className="mb-2"
                  label={
                    <span>
                      {activity.title} <span className="ms-2"><SourceBadge sourceType={activity.source_type} /></span>
                    </span>
                  }
                  checked={!!downloadSelection[activity.id]}
                  onChange={(e) =>
                    setDownloadSelection((prev) => ({
                      ...prev,
                      [activity.id]: e.target.checked,
                    }))
                  }
                />
              ))}
            </div>
            <div className="text-muted small mt-2">
              {selectedDownloadCount} selected
            </div>
          </Form.Group>

          <Form.Group className="mb-2 mt-4">
            <Form.Label>Secondary Google Folder Option</Form.Label>
            <Form.Control
              type="text"
              placeholder="Google folder URL (existing path)"
              value={downloadFolderUrl}
              onChange={(e) => setDownloadFolderUrl(e.target.value)}
            />
          </Form.Group>

          <Alert variant="info" className="mb-0">
            Local download works now. One selected activity downloads as a text file; multiple
            selected activities download as a JSON bundle. Zip support is next. Google-folder flow
            stays available as a secondary path.
          </Alert>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="primary" onClick={handleDownloadSelected}>
            Download Selected
          </Button>
          <Button variant="secondary" onClick={() => setShowDownloadModal(false)}>
            Close
          </Button>
          <Button variant="outline-secondary" onClick={() => {
            setShowDownloadModal(false);
            setShowFolderModal(true);
          }}>
            Open Google Folder Import
          </Button>
        </Modal.Footer>
      </Modal>

      {pendingActivity?.sheet_url && pendingActivity.sheet_url.trim() !== '' && (
        <Modal show={showShareModal} onHide={() => setShowShareModal(false)}>
          <Modal.Header closeButton>
            <Modal.Title>Share Document Access</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p>If your activity uses a Google Sheet or Doc, please ensure it is shared with:</p>
            <code>{SERVICE_ACCOUNT_EMAIL}</code>
            <p className="mt-3">
              Click "Continue" once you've shared access or if no document is being used.
            </p>
          </Modal.Body>
          <Modal.Footer>
            <Button
              variant="secondary"
              onClick={() => {
                setShowShareModal(false);
                setShowUploadModal(true);
              }}
            >
              Back
            </Button>
            <Button variant="primary" onClick={confirmShareAndCheckAccess}>
              Continue
            </Button>
          </Modal.Footer>
        </Modal>
      )}
    </Container>
  );
}
