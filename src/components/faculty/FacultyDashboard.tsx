import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Container,
  // Paper,
  Typography,
  Box,
  Grid,
  Card,
  CardContent,
  Button,
  TextField,
  // FormControl,
  // InputLabel,
  // Select,
  // MenuItem,
  Alert,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../../contexts/AuthContext';
import { useInterval } from '../../hooks/useInterval';

interface AttendanceReport {
  subject: string;
  totalSessions: number;
  students: {
    [key: string]: {
      name: string;
      email: string;
      attendanceCount: number;
      attendancePercentage: number;
    };
  };
}

const FacultyDashboard: React.FC = () => {
  const [subject, setSubject] = useState('');
  const [classroom, setClassroom] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [reports, setReports] = useState<AttendanceReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<AttendanceReport | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [isUpdating, setIsUpdating] = useState(false);
  const [currentSession, setCurrentSession] = useState<string | null>(null);
  const [sessionStudents, setSessionStudents] = useState<Array<{id: string, name: string, email: string}>>([]);
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);
  
  const qrDialogTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  const { user } = useAuth();
  


  // Clear timer when component unmounts
  useEffect(() => {
    return () => {
      if (qrDialogTimerRef.current) {
        clearTimeout(qrDialogTimerRef.current);
      }
    };
  }, []);

  const generateQRCode = async () => {
    if (!subject || !classroom) {
      setError('Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('http://localhost:5000/api/attendance/generate-qr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          subject,
          classRoom: classroom
        })
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Failed to generate QR code');
      }

      setQrCode(data.qrCode);
      setCurrentSession(data.sessionId);
      setShowQR(true);
      setSuccess('QR code generated successfully!');
      fetchReports(); // Refresh reports after generating new session
      
      // Set timer to close QR code dialog after 2 minutes
      if (qrDialogTimerRef.current) {
        clearTimeout(qrDialogTimerRef.current);
      }
      
      qrDialogTimerRef.current = setTimeout(() => {
        setShowQR(false);
        // Add a small delay before fetching session details to allow backend to update session status
        setTimeout(() => {
          fetchSessionStudents(data.sessionId);
        }, 1000); // 1 second delay
      }, 2 * 60 * 1000); // 2 minutes
    } catch (err: any) {
      setError(err.message || 'Failed to generate QR code');
    } finally {
      setLoading(false);
    }
  };

  // Fetch students who scanned the QR code for a specific session
  const fetchSessionStudents = async (sessionId: string, retryCount = 0) => {
    setIsLoadingStudents(true);
    setError(''); // Clear previous errors
    try {
      if (!sessionId) {
        setError('Invalid session ID');
        setSessionStudents([]);
        setIsLoadingStudents(false);
        return;
      }
      
      const response = await fetch(`http://localhost:5000/api/attendance/session/${sessionId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      // Handle different HTTP status codes
      if (response.status === 404) {
        setError('Session not found. It may have been deleted.');
        setSessionStudents([]);
        setIsLoadingStudents(false);
        return;
      }
      
      if (response.status === 403) {
        setError('You do not have access to this session.');
        setSessionStudents([]);
        setIsLoadingStudents(false);
        return;
      }
      
      if (response.status === 500) {
        
        // Retry logic for server errors (up to 2 retries)
        if (retryCount < 2) {
          setIsLoadingStudents(false);
          // Wait a bit before retrying
          setTimeout(() => {
            fetchSessionStudents(sessionId, retryCount + 1);
          }, 1000);
          return;
        }
        
        setError('Server error when fetching session. Please try again later.');
        setSessionStudents([]);
        setIsLoadingStudents(false);
        return;
      }

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Failed to fetch session details');
      }

      
      // Even if there are no students, still show the dialog
      setSessionStudents(data.students || []);
      
      // If session is expired, show a message but still display the students
      if (data.status === 'expired') {
        setSuccess(`This session has expired. Showing ${data.students?.length || 0} students who marked attendance.`);
      }
    } catch (err: any) {
      
      // Retry logic for network errors (up to 2 retries)
      if (retryCount < 2) {
        setIsLoadingStudents(false);
        // Wait a bit before retrying
        setTimeout(() => {
          fetchSessionStudents(sessionId, retryCount + 1);
        }, 1000);
        return;
      }
      
      setError(err.message || 'Failed to fetch session details');
      // Show empty list instead of error to allow Excel download
      setSessionStudents([]);
    } finally {
      setIsLoadingStudents(false);
    }
  };

  // Download Excel file for a session
  const downloadExcel = async (sessionId: string) => {
    setError(''); // Clear previous errors
    try {
      setSuccess('Preparing Excel file for download...');
      
      // Use XMLHttpRequest for better binary data handling
      const xhr = new XMLHttpRequest();
      xhr.open('GET', `http://localhost:5000/api/attendance/export/${sessionId}`, true);
      xhr.setRequestHeader('Authorization', `Bearer ${localStorage.getItem('token')}`);
      xhr.responseType = 'blob';
      
      xhr.onload = function() {
        if (this.status === 200) {
          
          const blob = this.response;
          if (blob.size === 0) {
            setError('Received empty Excel file');
            return;
          }
          
          // Create a link to download the file
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = url;
          a.download = `attendance_${new Date().toISOString().split('T')[0]}.xlsx`;
          document.body.appendChild(a);
          a.click();
          
          // Clean up
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
          
          setSuccess('Excel file downloaded successfully!');
        } else {
          setError(`Failed to download Excel file (Status: ${this.status})`);
        }
      };
      
      xhr.onerror = function() {
        setError('Network error during Excel download');
      };
      
      xhr.send();
    } catch (err: any) {
      setError(err.message || 'Failed to download Excel file');
    }
  };

  const fetchReports = useCallback(async () => {
    if (isUpdating) return; // Prevent multiple simultaneous updates
    setIsUpdating(true);
    try {
      const response = await fetch('http://localhost:5000/api/attendance/report', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Failed to fetch reports');
      }

      const newReports = Object.entries(data).map(([subject, report]: [string, any]) => ({
        subject,
        ...report
      }));

      // Compare with current reports to check for changes
      const hasChanges = JSON.stringify(newReports) !== JSON.stringify(reports);
      if (hasChanges) {
        setReports(newReports);
        setLastUpdate(new Date());
        // If a report is selected, update it as well
        if (selectedReport) {
          const updatedSelectedReport = newReports.find(r => r.subject === selectedReport.subject);
          if (updatedSelectedReport) {
            setSelectedReport(updatedSelectedReport);
          }
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch reports');
    } finally {
      setIsUpdating(false);
    }
  }, [reports, selectedReport]);

  // Initial fetch
  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  // Set up interval for real-time updates
  useInterval(() => {
    fetchReports();
  }, 5000); // Check every 5 seconds

  // Memoize the onClose handler for dialogs to prevent unnecessary re-renders
  const handleCloseQRDialog = useCallback(() => {
    setShowQR(false);
    if (qrDialogTimerRef.current) {
      clearTimeout(qrDialogTimerRef.current);
      qrDialogTimerRef.current = null;
    }
    if (currentSession) {
      fetchSessionStudents(currentSession);
    }
  }, [currentSession]);

  const handleCloseStudentsDialog = useCallback(() => {
    setSessionStudents([]);
    setCurrentSession(null);
  }, []);

  const handleCloseReportDialog = useCallback(() => {
    setSelectedReport(null);
  }, []);

  return (
    <Container maxWidth="lg">
      <Box sx={{ mt: 4, mb: 4 }}>
        <Grid container spacing={3}>
          {/* Faculty Info Card */}
          <Grid item xs={12} md={4}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Faculty Information
                </Typography>
                <Typography>Name: {user?.name}</Typography>
                <Typography>Department: {user?.department}</Typography>
                <Typography>Email: {user?.email}</Typography>
              </CardContent>
            </Card>
          </Grid>

          {/* QR Generation Card */}
          <Grid item xs={12} md={8}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Generate Attendance QR Code
                </Typography>
                {error && (
                  <Alert severity="error" sx={{ mb: 2 }}>
                    {error}
                  </Alert>
                )}
                {success && (
                  <Alert severity="success" sx={{ mb: 2 }}>
                    {success}
                  </Alert>
                )}
                <Grid container spacing={2}>
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      label="Subject"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      margin="normal"
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      label="Classroom"
                      value={classroom}
                      onChange={(e) => setClassroom(e.target.value)}
                      margin="normal"
                    />
                  </Grid>
                </Grid>
                <Button
                  fullWidth
                  variant="contained"
                  onClick={generateQRCode}
                  disabled={loading}
                  sx={{ mt: 2 }}
                >
                  {loading ? <CircularProgress size={24} /> : 'Generate QR Code'}
                </Button>
              </CardContent>
            </Card>
          </Grid>

          {/* Attendance Reports */}
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Typography variant="h6">
                    Attendance Reports
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    {isUpdating && <CircularProgress size={20} sx={{ mr: 1 }} />}
                    <Typography variant="caption" color="text.secondary">
                      Last updated: {lastUpdate.toLocaleTimeString()}
                    </Typography>
                  </Box>
                </Box>
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Subject</TableCell>
                        <TableCell>Total Sessions</TableCell>
                        <TableCell>Total Students</TableCell>
                        <TableCell>Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {reports.map((report) => (
                        <TableRow key={report.subject}>
                          <TableCell>{report.subject}</TableCell>
                          <TableCell>{report.totalSessions}</TableCell>
                          <TableCell>{Object.keys(report.students).length}</TableCell>
                          <TableCell>
                            <Button
                              variant="outlined"
                              size="small"
                              onClick={() => setSelectedReport(report)}
                            >
                              View Details
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {reports.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} align="center">
                            No attendance reports found
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Box>

      {/* QR Code Dialog */}
      <Dialog 
        open={showQR} 
        onClose={handleCloseQRDialog}
        maxWidth="md"
      >
        <DialogTitle>Scan QR Code</DialogTitle>
        <DialogContent>
          <Box sx={{ p: 2, textAlign: 'center' }}>
            {qrCode && (
              <QRCodeSVG
                value={qrCode}
                size={256}
                level="H"
              />
            )}
            <Typography variant="body2" sx={{ mt: 2 }}>
              This QR code will expire in 2 minutes
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseQRDialog}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Session Students Dialog - Show even if no students */}
      <Dialog
        open={!showQR && currentSession !== null && !isLoadingStudents}
        onClose={handleCloseStudentsDialog}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Students Who Scanned the QR Code
        </DialogTitle>
        <DialogContent>
          {isLoadingStudents ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
              <CircularProgress />
            </Box>
          ) : (
            <>
              {sessionStudents.length === 0 ? (
                <Box sx={{ p: 3, textAlign: 'center' }}>
                  <Typography variant="body1">
                    No students scanned this QR code.
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    You can still download an empty Excel sheet.
                  </Typography>
                </Box>
              ) : (
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Student Name</TableCell>
                        <TableCell>Email</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {sessionStudents.map((student) => (
                        <TableRow key={student.id}>
                          <TableCell>{student.name}</TableCell>
                          <TableCell>{student.email}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button 
            variant="contained" 
            color="primary" 
            onClick={() => currentSession && downloadExcel(currentSession)}
          >
            Export to Excel
          </Button>
          <Button onClick={handleCloseStudentsDialog}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Report Details Dialog */}
      <Dialog
        open={!!selectedReport}
        onClose={handleCloseReportDialog}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Attendance Details - {selectedReport?.subject}
        </DialogTitle>
        <DialogContent>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Student Name</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Attendance</TableCell>
                  <TableCell>Percentage</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {selectedReport && Object.entries(selectedReport.students).map(([id, student]) => (
                  <TableRow key={id}>
                    <TableCell>{student.name}</TableCell>
                    <TableCell>{student.email}</TableCell>
                    <TableCell>{student.attendanceCount} / {selectedReport.totalSessions}</TableCell>
                    <TableCell>
                      {typeof student.attendancePercentage === 'number' 
                        ? `${student.attendancePercentage.toFixed(1)}%`
                        : `${(student.attendanceCount / selectedReport.totalSessions * 100).toFixed(1)}%`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseReportDialog}>Close</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default FacultyDashboard;