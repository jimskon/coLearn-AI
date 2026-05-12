// src/pages/ManageActivitiesPage.jsx
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import { API_BASE_URL } from '../config';
import { Table, Button, Form, Container, Modal, Alert, Badge, Spinner } from 'react-bootstrap';

const SERVICE_ACCOUNT_EMAIL = import.meta.env.VITE_SERVICE_ACCOUNT_EMAIL;

export default function ManageActivitiesPage() {
  const { id: classId } = useParams();
  const { user } = useUser();
  const navigate = useNavigate();

  const [activities, setActivities] = useState([]);
  const [newActivity, setNewActivity] = useState({
    name: '',
    title: '',
    sheet_url: '',
    order_index: ''
  });

  const [showModal, setShowModal] = useState(false);
  const [pendingActivity, setPendingActivity] = useState(null);
  const canManage = user?.role === 'root' || user?.role === 'creator';
  const [showImportFolderModal, setShowImportFolderModal] = useState(false);
  const [folderUrl, setFolderUrl] = useState('');
  const [showClassFolderModal, setShowClassFolderModal] = useState(false);
  const [classFolder, setClassFolder] = useState(null);
  const [classFolderUrlInput, setClassFolderUrlInput] = useState('');
  const [classFolderLoading, setClassFolderLoading] = useState(false);
  const [classFolderVerifyLoading, setClassFolderVerifyLoading] = useState(false);
  const [classFolderSaveLoading, setClassFolderSaveLoading] = useState(false);
  const [classFolderRemoveLoading, setClassFolderRemoveLoading] = useState(false);
  const [classFolderError, setClassFolderError] = useState('');
  const [classFolderSuccess, setClassFolderSuccess] = useState('');
  const [verifiedClassFolder, setVerifiedClassFolder] = useState(null);
  const [serviceAccountCopied, setServiceAccountCopied] = useState(false);

  useEffect(() => {
    if (!canManage) {
      navigate('/dashboard');
      return;
    }

    fetch(`${API_BASE_URL}/api/classes/${classId}/activities`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setActivities(data);
        } else {
          console.error("Unexpected response format:", data);
        }
      })
      .catch(err => {
        console.error("Fetch error:", err);
      });

    fetch(`${API_BASE_URL}/api/classes/${classId}/folder`)
      .then(res => res.json())
      .then(data => {
        if (data && typeof data === 'object') {
          setClassFolder(data);
        }
      })
      .catch(err => {
        console.error("Class folder fetch error:", err);
      });
  }, [canManage, classId, navigate]);

  const handleChange = (e) => {
    setNewActivity({ ...newActivity, [e.target.name]: e.target.value });
  };

  const handleAdd = async () => {
    const activity = {
      ...newActivity,
      order_index: parseInt(newActivity.order_index, 10),
      createdBy: user?.id
    };

    if (!activity.sheet_url || activity.sheet_url.trim() === '') {
      saveActivity(activity);
      return;
    }

    setPendingActivity(activity);
    setShowModal(true);
  };

  const handleBulkImport = async () => {
    setShowImportFolderModal(false);
    const res = await fetch(`${API_BASE_URL}/api/classes/${classId}/import-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderUrl, createdBy: user.id })
    });
    const data = await res.json();
    if (res.ok) {
      setActivities([...activities, ...data.imported]);
      setFolderUrl('');
    } else {
      alert(data.error || "Folder import failed.");
    }
  };

  const loadClassFolder = async () => {
    setClassFolderLoading(true);
    setClassFolderError('');
    setClassFolderSuccess('');
    setVerifiedClassFolder(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/classes/${classId}/folder`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load class folder.');
      }
      setClassFolder(data);
      setClassFolderUrlInput(data.folder_url || '');
    } catch (err) {
      setClassFolderError(err.message || 'Failed to load class folder.');
    } finally {
      setClassFolderLoading(false);
    }
  };

  const openClassFolderModal = async () => {
    setShowClassFolderModal(true);
    await loadClassFolder();
  };

  const handleVerifyClassFolder = async () => {
    setClassFolderVerifyLoading(true);
    setClassFolderError('');
    setClassFolderSuccess('');
    setVerifiedClassFolder(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/classes/${classId}/folder/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderUrl: classFolderUrlInput }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to verify class folder.');
      }

      setVerifiedClassFolder({
        folderUrl: classFolderUrlInput,
        folderId: data.folder_id,
        folderName: data.folder_name,
      });
      setClassFolderSuccess(`Verified access to ${data.folder_name || 'folder'}.`);
    } catch (err) {
      setClassFolderError(err.message || 'Failed to verify class folder.');
    } finally {
      setClassFolderVerifyLoading(false);
    }
  };

  const handleSaveClassFolder = async () => {
    if (!verifiedClassFolder || verifiedClassFolder.folderUrl !== classFolderUrlInput) return;

    setClassFolderSaveLoading(true);
    setClassFolderError('');
    setClassFolderSuccess('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/classes/${classId}/folder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderUrl: classFolderUrlInput }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save class folder.');
      }

      setClassFolder({
        class_id: Number(classId),
        has_folder: true,
        folder_url: data.folder_url,
        folder_id: data.folder_id,
        folder_name: data.folder_name,
        status: data.status,
        verified_at: new Date().toISOString(),
      });
      setClassFolderSuccess(`Saved ${data.folder_name || 'class folder'}.`);
    } catch (err) {
      setClassFolderError(err.message || 'Failed to save class folder.');
    } finally {
      setClassFolderSaveLoading(false);
    }
  };

  const handleRemoveClassFolder = async () => {
    if (!window.confirm('Remove the folder attachment from this class? Existing activities will not be changed.')) {
      return;
    }

    setClassFolderRemoveLoading(true);
    setClassFolderError('');
    setClassFolderSuccess('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/classes/${classId}/folder`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to remove class folder.');
      }

      setClassFolder({
        class_id: Number(classId),
        has_folder: false,
      });
      setClassFolderUrlInput('');
      setVerifiedClassFolder(null);
      setClassFolderSuccess('Class folder removed.');
    } catch (err) {
      setClassFolderError(err.message || 'Failed to remove class folder.');
    } finally {
      setClassFolderRemoveLoading(false);
    }
  };

  const classFolderNeedsReverify = verifiedClassFolder && verifiedClassFolder.folderUrl !== classFolderUrlInput;

  const copyServiceAccountEmail = async () => {
    if (!SERVICE_ACCOUNT_EMAIL) return;

    try {
      await navigator.clipboard.writeText(SERVICE_ACCOUNT_EMAIL);
      setServiceAccountCopied(true);
      window.setTimeout(() => setServiceAccountCopied(false), 1800);
    } catch (err) {
      console.error('Failed to copy service account email:', err);
    }
  };

  const renderServiceAccountHelper = () => (
    <span className="d-inline-flex flex-wrap align-items-center gap-2">
      <span>Make sure the folder is shared with</span>
      <code
        className="px-2 py-1 rounded"
        style={{ backgroundColor: '#e7f1ff', color: '#0d6efd', fontWeight: 600 }}
      >
        {SERVICE_ACCOUNT_EMAIL || 'the service account'}
      </code>
      {SERVICE_ACCOUNT_EMAIL && (
        <Button
          variant={serviceAccountCopied ? 'success' : 'outline-primary'}
          size="sm"
          className="py-0 px-2"
          onClick={copyServiceAccountEmail}
        >
          {serviceAccountCopied ? 'Copied' : 'Copy'}
        </Button>
      )}
      <span>as an editor.</span>
    </span>
  );

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

    // Reset the form immediately so the add flow stays snappy.
    setNewActivity({ name: '', title: '', sheet_url: '', order_index: '' });

    // Re-fetch list from DB (single source of truth). Activity metadata is now
    // initialized server-side, so we no longer need the old preview side-effect.
    const refreshed = await fetch(
      `${API_BASE_URL}/api/classes/${classId}/activities`,
      { credentials: 'include' }
    );

    const refreshedData = await refreshed.json();
    if (Array.isArray(refreshedData)) setActivities(refreshedData);
  };


  const confirmShareAndCheckAccess = async () => {
    setShowModal(false);
    if (!pendingActivity?.sheet_url) {
      saveActivity(pendingActivity);
      setPendingActivity(null);
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/activities/check-access?url=${encodeURIComponent(pendingActivity.sheet_url)}`);

      let result = { access: false };
      if (res.ok) {
        const text = await res.text();
        if (text) {
          result = JSON.parse(text);
        }
      }

      if (res.ok && result.access) {
        saveActivity(pendingActivity);
      } else {
        alert("Access denied or document not found. Please ensure the document is shared and the URL is correct.");
        setNewActivity(pendingActivity);
      }
    } catch (err) {
      console.error("Error checking access:", err);
      alert("Error checking document access. Please try again.");
      setNewActivity(pendingActivity);
    }

    setPendingActivity(null);
  };

  const handleDelete = async (activityId) => {
    const res = await fetch(`${API_BASE_URL}/api/classes/${classId}/activities/${activityId}`, {
      method: 'DELETE'
    });

    if (res.ok) {
      setActivities(activities.filter(a => a.id !== activityId));
    } else {
      const data = await res.json();
      alert(data.error || "Delete failed.");
    }
  };


  const handleUpdate = async (activity) => {
    const payload = {
      title: activity.title,
      sheet_url: activity.sheet_url,
      order_index: parseInt(activity.order_index, 10)
    };

    const res = await fetch(`${API_BASE_URL}/api/classes/${classId}/activities/${activity.name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const updated = await res.json();
      setActivities(activities.map(a => a.name === updated.name ? updated : a));
    } else {
      const err = await res.text();
      console.error("Update failed:", err);
      alert("Update failed.");
    }
  };

  const handleFieldChange = (name, field, value) => {
    setActivities(activities.map(a =>
      a.name === name ? { ...a, [field]: value } : a
    ));
  };

  return (
    <Container>
      <h2 className="mb-4">Manage POGIL Activities for Class {classId}</h2>
      <div className="d-flex align-items-center gap-2 mb-3">
        <strong>Class Folder:</strong>
        {classFolder?.has_folder ? (
          <>
            <Badge bg={classFolder.status === 'verified' ? 'success' : 'secondary'}>
              {classFolder.status === 'verified' ? 'Verified' : 'Attached'}
            </Badge>
            {classFolder.folder_name && <span>{classFolder.folder_name}</span>}
          </>
        ) : (
          <Badge bg="secondary">No Folder</Badge>
        )}
        <Button variant="outline-secondary" size="sm" onClick={openClassFolderModal}>
          {classFolder?.has_folder ? 'Manage Folder' : 'Attach Folder'}
        </Button>
      </div>

      <Form className="mb-4">
        <h4>Add New Activity</h4>
        <Form.Group className="mb-2">
          <Form.Control
            name="name"
            placeholder="Activity ID"
            value={newActivity.name}
            onChange={handleChange}
          />
        </Form.Group>
        <Form.Group className="mb-2">
          <Form.Control
            name="title"
            placeholder="Title"
            value={newActivity.title}
            onChange={handleChange}
          />
        </Form.Group>
        <Form.Group className="mb-2">
          <Form.Control
            name="sheet_url"
            placeholder="Google Sheet or Doc URL"
            value={newActivity.sheet_url}
            onChange={handleChange}
          />
        </Form.Group>
        <Form.Group className="mb-3">
          <Form.Control
            name="order_index"
            type="number"
            placeholder="Order Index"
            value={newActivity.order_index}
            onChange={handleChange}
          />
        </Form.Group>
        <Button variant="primary" onClick={handleAdd}>Add Activity</Button>
        <Button
          variant="secondary"
          className="mb-4"
          onClick={() => setShowImportFolderModal(true)}
        >
          Import Activities from Google Folder
        </Button>


      </Form>

      <h4>Current Activities</h4>
      <Table striped bordered hover responsive>
        <thead>
          <tr>
            <th>Name</th>
            <th>Title</th>
            <th>Sheet URL</th>
            <th>Order</th>
            <th style={{ width: '30%' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {activities.map(activity => (
            <tr key={activity.name}>
              <td>
                <Form.Control value={activity.name} readOnly />
              </td>
              <td>
                <Form.Control
                  value={activity.title}
                  onChange={e => handleFieldChange(activity.name, 'title', e.target.value)}
                />
              </td>
              <td>
                <Form.Control
                  value={activity.sheet_url}
                  onChange={e => handleFieldChange(activity.name, 'sheet_url', e.target.value)}
                />
              </td>
              <td>
                <Form.Control
                  type="number"
                  value={activity.order_index}
                  onChange={e => handleFieldChange(activity.name, 'order_index', parseInt(e.target.value, 10))}
                />
              </td>
              <td>
                <Button variant="success" size="sm" onClick={() => handleUpdate(activity)} className="me-2">Update</Button>
                <Button variant="info" size="sm" onClick={() => {
                  if (!activity.sheet_url) {
                    alert("No document URL specified for this activity.");
                  } else {
                    navigate(`/preview/${activity.id}?returnTo=${encodeURIComponent(location.pathname)}`);
                  }
                }} className="me-2">Preview</Button>
                <Button variant="warning" size="sm" onClick={() => navigate(`/editor/${activity.id}`)} className="me-2">Edit</Button>
                <Button variant="danger" size="sm" onClick={() => handleDelete(activity.id)}>Delete</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Modal show={showImportFolderModal} onHide={() => setShowImportFolderModal(false)}>
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
          <div className="mt-2 small text-muted">{renderServiceAccountHelper()}</div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowImportFolderModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleBulkImport}>Import</Button>
        </Modal.Footer>
      </Modal>
      <Modal
        show={showClassFolderModal}
        onHide={() => {
          if (!classFolderLoading && !classFolderVerifyLoading && !classFolderSaveLoading && !classFolderRemoveLoading) {
            setShowClassFolderModal(false);
          }
        }}
        centered
      >
        <Modal.Header closeButton={!classFolderLoading && !classFolderVerifyLoading && !classFolderSaveLoading && !classFolderRemoveLoading}>
          <Modal.Title>{classFolder?.has_folder ? 'Manage Class Folder' : 'Attach Class Folder'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {classFolderLoading ? (
            <div className="d-flex align-items-center gap-2">
              <Spinner animation="border" size="sm" />
              <span>Loading folder settings...</span>
            </div>
          ) : (
            <>
              <p className="text-muted mb-3">
                Local activities for this class will use this Google Drive folder by default.
                External activities can still be linked separately.
              </p>

              {classFolderError && <Alert variant="danger">{classFolderError}</Alert>}
              {classFolderSuccess && <Alert variant="success">{classFolderSuccess}</Alert>}
              {classFolderNeedsReverify && (
                <Alert variant="warning" className="py-2">
                  Folder URL changed. Verify again before saving.
                </Alert>
              )}

              <Form.Group className="mb-3">
                <Form.Label>Google Folder URL</Form.Label>
                <Form.Control
                  type="url"
                  value={classFolderUrlInput}
                  onChange={(e) => {
                    setClassFolderUrlInput(e.target.value);
                    setClassFolderError('');
                    setClassFolderSuccess('');
                  }}
                  placeholder="https://drive.google.com/drive/folders/..."
                />
                <Form.Text className="text-muted">
                  {renderServiceAccountHelper()}
                </Form.Text>
              </Form.Group>

              {classFolder?.has_folder && (
                <div className="mb-3">
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <strong>Current status:</strong>
                    <Badge bg={classFolder.status === 'verified' ? 'success' : 'secondary'}>
                      {classFolder.status === 'verified' ? 'Verified' : 'Attached'}
                    </Badge>
                  </div>
                  {classFolder.folder_name && <div><strong>Folder:</strong> {classFolder.folder_name}</div>}
                  {classFolder.folder_id && <div><strong>Folder ID:</strong> {classFolder.folder_id}</div>}
                  {classFolder.folder_url && (
                    <div className="mt-2">
                      <a href={classFolder.folder_url} target="_blank" rel="noreferrer">Open Folder</a>
                    </div>
                  )}
                </div>
              )}

              {verifiedClassFolder && verifiedClassFolder.folderUrl === classFolderUrlInput && (
                <Alert variant="info" className="py-2 mb-0">
                  Ready to save: {verifiedClassFolder.folderName || verifiedClassFolder.folderId}
                </Alert>
              )}
            </>
          )}
        </Modal.Body>
        <Modal.Footer className="d-flex justify-content-between">
          <div>
            {classFolder?.has_folder && (
              <Button
                variant="outline-danger"
                onClick={handleRemoveClassFolder}
                disabled={classFolderLoading || classFolderVerifyLoading || classFolderSaveLoading || classFolderRemoveLoading}
              >
                {classFolderRemoveLoading ? 'Removing...' : 'Remove Folder'}
              </Button>
            )}
          </div>
          <div className="d-flex gap-2">
            <Button
              variant="secondary"
              onClick={() => setShowClassFolderModal(false)}
              disabled={classFolderLoading || classFolderVerifyLoading || classFolderSaveLoading || classFolderRemoveLoading}
            >
              Close
            </Button>
            <Button
              variant="outline-primary"
              onClick={handleVerifyClassFolder}
              disabled={!classFolderUrlInput || classFolderLoading || classFolderVerifyLoading || classFolderSaveLoading || classFolderRemoveLoading}
            >
              {classFolderVerifyLoading ? 'Verifying...' : 'Verify Access'}
            </Button>
            <Button
              variant="primary"
              onClick={handleSaveClassFolder}
              disabled={
                !verifiedClassFolder ||
                verifiedClassFolder.folderUrl !== classFolderUrlInput ||
                classFolderLoading ||
                classFolderVerifyLoading ||
                classFolderSaveLoading ||
                classFolderRemoveLoading
              }
            >
              {classFolderSaveLoading ? 'Saving...' : 'Save Folder'}
            </Button>
          </div>
        </Modal.Footer>
      </Modal>
      {pendingActivity?.sheet_url && pendingActivity.sheet_url.trim() !== '' && (
        <Modal show={showModal} onHide={() => setShowModal(false)}>
          <Modal.Header closeButton>
            <Modal.Title>Share Document Access</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <p>If your activity uses a Google Sheet or Doc, please ensure it is shared with:</p>
            <div>{renderServiceAccountHelper()}</div>
            <p className="mt-3">Click "Continue" once you've shared access or if no document is being used.</p>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={confirmShareAndCheckAccess}>Continue</Button>
          </Modal.Footer>
        </Modal>
      )}
    </Container>
  );
}
