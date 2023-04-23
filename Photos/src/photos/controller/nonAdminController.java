package photos.controller;



import javafx.collections.FXCollections;
import javafx.collections.ObservableList;
import javafx.event.Event;
import javafx.event.EventHandler;
import javafx.fxml.FXML;
import javafx.fxml.FXMLLoader;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.Scene;
import javafx.scene.control.*;
import javafx.scene.control.Alert.AlertType;
import javafx.scene.input.KeyCode;
import javafx.scene.input.KeyEvent;
import javafx.scene.input.MouseButton;
import javafx.scene.input.MouseEvent;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Pane;
import javafx.scene.layout.VBox;
import javafx.stage.Modality;
import javafx.stage.Stage;
import photos.utility.User;
import java.nio.file.*;
import java.text.DateFormat;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.io.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.Locale;
import java.util.Optional;

import photos.utility.Album;
import photos.utility.Photo;
import photos.utility.Privacy;
import photos.utility.SceneLoader;

/**
 * The controller for the main screen when logged in with a non admin user, provides basic functionalities
 * @author Zihao Zheng , Yiming Huang
 * @since 4/13/23 
 */
public class nonAdminController implements Serializable{
	
	private static final long serialVersionUID = 1L;
	
	/** The current user logged in */
	public static User currUser = null;
	
	/** The reference of the stage we are on right now */
	Stage mainStage;
	
	/**Double click handler for the list view so that when a album is double clicked, we automatically open the album*/
	EventHandler<MouseEvent> doubleClickHandler=null;
	
	/**

	The JavaFX ListView component that displays a list of the user's albums.
	*/
	@FXML ListView<String> albumList;
	/**

	The JavaFX Button component that creates a new album.
	*/
	@FXML Button create;
	/**

	The JavaFX Button component that renames an existing album.
	*/
	@FXML Button rename;
	/**

	The JavaFX Button component that opens a selected album.
	*/
	@FXML Button open;
	/**

	The JavaFX Button component that deletes a selected album.
	*/
	@FXML Button delete;
	/**

	The JavaFX Button component that logs the user out of the system.
	*/
	@FXML Button logout;
	/**

	The JavaFX Button component that searches for photos within albums.
	*/
	@FXML Button search;
	/**

	The JavaFX TextField component that holds the search target for photos.
	*/
	@FXML TextField searchTarget;
	/**

	The JavaFX ComboBox component that selects the search method for photos.
	*/
	@FXML ComboBox<String> searchMethod;
	/**

	The JavaFX Label component that displays a welcome message to the user.
	*/
	@FXML Label welcome;
	/**

	The JavaFX Label component that displays information to the user.
	*/
	@FXML Label info;
	/**

	The JavaFX DatePicker component that selects the start date for a photo search.
	*/
	@FXML DatePicker from;
	/**

	The JavaFX DatePicker component that selects the end date for a photo search.
	*/
	@FXML DatePicker to;
	
	
	/**
	Set the main stage and initialize the UI components for album view.
	@param stage the main stage to be set
	@throws IOException if an I/O error occurs when loading the album
	*/
	public void setMainStage(Stage stage) throws IOException{		
		// Keep the copy of "The Stage"
		mainStage = stage;
		
		
		// Load the combo box items
		ObservableList<String> searchMethods = FXCollections.observableArrayList(
		    "Date",
		    "Tag"
		);
		searchMethod.setItems(searchMethods);
		searchMethod.setValue(searchMethods.get(1)); // Set the first item as the default value
		from.setVisible(false);
        to.setVisible(false);
		
		// Load the user's album into the list view
		loadAlbum();
		
		from.setEditable(false);to.setEditable(false);
		
		// Change the label to the username
		welcome.setText("Welcome, "+currUser.getUsername().toUpperCase());
		
		searchMethod.setOnAction(e -> {
            if (searchMethod.getValue().equals("Tag")) {
            	info.setText("e.g. : \"person=sesh AND location=prague\" or \"person=sesh OR location=prague\" or \"location=PRC\"");
                from.setVisible(false);
                to.setVisible(false);
            } else {
                info.setText("e.g. 04/13/23 to 04/14/23 will get all the photos in that range");
                from.setVisible(true);
                to.setVisible(true);
            }
        });

		
		// double click event
		doubleClickHandler = new EventHandler<MouseEvent>() {
		    @Override
		    public void handle(MouseEvent event) {
		        if (event.getButton().equals(MouseButton.PRIMARY) && event.getClickCount() == 2) {
		        	try {
						openAlbum();
					} catch (IOException e) {
						// TODO Auto-generated catch block
						e.printStackTrace();
					}
		        }
		    }
		};

		albumList.setOnMouseClicked(doubleClickHandler);


	}

	/**
	Counts the number of subdirectories in the given directory path.
	@param directoryPath the path of the directory to count subdirectories in
	@return the number of subdirectories in the directory
	*/
	public int count(String directoryPath) {
	    File directory = new File(directoryPath);
	    int count = 0;
	    if (directory.exists() && directory.isDirectory()) {
	        for (File subdirectory : directory.listFiles()) {
	            if (subdirectory.isDirectory()) {
	                count++;
	            }
	        }
	    }
	    return count;
	}
	
	/**
	Counts the number of subdirectories in a given directory path and returns the count as an integer.
	@param directoryPath The path of the directory to be searched for subdirectories.
	@return An integer representing the number of subdirectories in the specified directory.
	*/
	public void loadAlbum() {
		this.albumList.getItems().clear();
		
		if(currUser.albums!=null && currUser.albums.size()>0) {
			// Define a custom Comparator for sorting albums by name
			Comparator<Album> albumNameComparator = new Comparator<Album>() {
			    @Override
			    public int compare(Album album1, Album album2) {
			        return album1.getAlbumName().compareToIgnoreCase(album2.getAlbumName());
			    }
			};

			// Sort the albums list using the custom Comparator
			Collections.sort(currUser.albums, albumNameComparator);
		}else {
			return;
		}
		for(int i=0;i<currUser.albums.size();i++) {
			albumList.getItems().add(currUser.albums.get(i).getAlbumName());
		}
	}
	
	/**
	Sorts an array of files by their names in ascending order (ignoring case).
	@param files an array of File objects to be sorted
	*/
	public static void sortFilesByName(File[] files) {
	    Arrays.sort(files, new Comparator<File>() {
	        public int compare(File f1, File f2) {
	            return f1.getName().compareToIgnoreCase(f2.getName());
	        }
	    });
	}

	/**
	Returns an array of File objects representing the folders within the given directory path.
	@param directoryPath the path of the directory to search for folders
	@return an array of File objects representing the folders within the given directory path
	*/
	public File[] getFolders(String directoryPath) {
        File folder = new File(directoryPath);
        File[] listOfFiles = folder.listFiles();
        return listOfFiles;
//        if (listOfFiles == null) {
//            System.out.println("No files found in directory.");
//            return;
//        }
//        
//        for (File file : listOfFiles) {
//            if (file.isDirectory()) {
//                System.out.println(file.getName());
//            }
//        }
    }
	
	/**
	Creates a new folder with the given name in the specified parent directory.
	If the folder already exists, nothing is created.
	@param parentPath the path of the parent directory where the new folder will be created
	@param folderName the name of the new folder to be created
	@throws IOException if an I/O error occurs when creating the directory
	*/
	public static void createFolder(String parentPath, String folderName) throws IOException {
	    Path path = Paths.get(parentPath, folderName);
	    
	    //  creates the folder at the specified path if it doesn't already exist.
	    Files.createDirectories(path);
	}
	
	/**
	Check if a path exists.
	@param path The path to check.
	@return true if the path exists, false otherwise.
	*/
	public boolean pathExists(String path) {
	    Path filePath = Paths.get(path);
	    return Files.exists(filePath);
	}
	
	/**
	Displays a pop-up dialog for creating a new album, validates the input, updates the backend and front end,
	and then displays a success message after the new album has been created.
	@throws IOException if an I/O error occurs
	*/
	@FXML public void createNewAlbum() throws IOException {   
        // Create the dialog layout
        Label titleLabel = new Label("Enter new album name:");
        TextField nameField = new TextField();
        Button confirmButton = new Button("Confirm");
        Button cancelButton = new Button("Cancel");
        HBox buttonBox = new HBox(10, confirmButton, cancelButton);
        VBox dialogBox = new VBox(10, titleLabel, nameField, buttonBox);
        dialogBox.setAlignment(Pos.CENTER);
        dialogBox.setPadding(new Insets(10, 10, 10, 10));
        
        // Create the pop-up dialog window
        Stage dialog = new Stage();
        dialog.initModality(Modality.APPLICATION_MODAL);
        dialog.initOwner(mainStage);
        dialog.setScene(new Scene(dialogBox));
        
        // Disable the main window while the pop-up dialog is open
        dialog.setOnShowing(event -> mainStage.setOpacity(0.7));
        dialog.setOnHidden(event -> mainStage.setOpacity(1));
        
        // Set the action for the Confirm button
        confirmButton.setOnAction(event -> {
            String name = nameField.getText().trim();
            String albumName = null;
            if (name.isEmpty()) {
                showMiniDialoge("Album name cannot be empty.");
            } else {
                albumName = name;
                if(albumName != null && checkExistence(albumName)) {
                	showMiniDialoge("Album already exists");
                }else {
                	if(currUser.albums==null || currUser.albums.size()<=0) currUser.albums=new ArrayList<Album>();
                	
                	currUser.albums.add(new Album(albumName)); // update the our backend
//                	albumList.getItems().add(albumName); // update front end
                	try {
    					Privacy.serialize();// send backend to cloud
    				} catch (IOException e) {
    					// TODO Auto-generated catch block
    					e.printStackTrace();
    				}
//    				createFolder(userSpace,albumName);
    				showMiniDialoge("Successful");
    				loadAlbum();
    				dialog.close();
                }
            }
            
            
        });
        
        // Set the action for the Cancel button
        cancelButton.setOnAction(event -> dialog.close());
        
        // Show the pop-up dialog
        dialog.showAndWait();
        
	}
	
	/**
	Checks if an album with the specified name exists in the current user's list of albums.
	If an album with the same name exists, returns true. Otherwise, returns false.
	@param name the name of the album to check for existence
	@return true if an album with the specified name exists in the current user's list of albums, false otherwise
	*/
	public boolean checkExistence(String name) {
		// Checks if an album exists. If so, returns true
		if(currUser.albums==null || currUser.albums.size()<=0) {
			return false;
		}
		for (int i=0;i<currUser.albums.size();i++) {
			String albumName = currUser.albums.get(i).getAlbumName();
	        if (albumName.equals(name)) {
	            return true;
	        }
	    }
	    return false;
		
		
		
//		File [] albumList = getFolders(userSpace);
//		for(File album : albumList) {
//			if (album.isDirectory() && album.getName().equals(name)) {
//              return true;
//			}
//		}
//		return false;
		
		
	}
	
	/**
	Displays a pop-up dialog box with the given message.
	@param message the message to be displayed in the dialog box
	*/
	private void showMiniDialoge(String message) {
	    Stage dialog = new Stage();
	    dialog.initModality(Modality.APPLICATION_MODAL);
	    dialog.initOwner(mainStage);
	    
	    // Create a VBox layout pane to wrap the label
	    VBox vbox = new VBox(10); // Set spacing between nodes
	    vbox.setPadding(new Insets(10)); // Set padding around the VBox
	    vbox.setAlignment(Pos.CENTER); // Align contents to center
	    
	    Label label = new Label(message);
	    vbox.getChildren().add(label); // Add the label to the VBox
	    
	    dialog.setScene(new Scene(vbox));
	    dialog.showAndWait();
	}

	/**
	 Renames the album selected
	 */
	public void renameAlbum() {
		if(albumList.getSelectionModel().getSelectedIndex()<0) {
			Alert alertDialog = new Alert(AlertType.WARNING);
			alertDialog.initOwner(mainStage);
			alertDialog.setTitle("Rename warning");
			alertDialog.setHeaderText("Nothing is selected");
			alertDialog.setContentText("Please select a album before continuing to rename");
			alertDialog.showAndWait();
			return;
		}
		// Create the dialog layout
        Label titleLabel = new Label("Enter album's new name:");
        TextField nameField = new TextField();
        Button confirmButton = new Button("Confirm");
        Button cancelButton = new Button("Cancel");
        HBox buttonBox = new HBox(10, confirmButton, cancelButton);
        VBox dialogBox = new VBox(10, titleLabel, nameField, buttonBox);
        dialogBox.setAlignment(Pos.CENTER);
        dialogBox.setPadding(new Insets(10, 10, 10, 10));
        
        // Create the pop-up dialog window
        Stage dialog = new Stage();
        dialog.initModality(Modality.APPLICATION_MODAL);
        dialog.initOwner(mainStage);
        dialog.setScene(new Scene(dialogBox));
        
        // Disable the main window while the pop-up dialog is open
        dialog.setOnShowing(event -> mainStage.setOpacity(0.7));
        dialog.setOnHidden(event -> mainStage.setOpacity(1));
        
        // Set the action for the Confirm button
        confirmButton.setOnAction(event -> {
        	String name = nameField.getText().trim();
            if (name.isEmpty()) {
                showMiniDialoge("Album name cannot be empty.");
                return;
            }
            if(checkExistence(name)) {
            	showMiniDialoge("Album already exists");
            }else {
//				renameFolder(userSpace,albumList.getSelectionModel().getSelectedItem(),name);
            	
            	// update backend (not saved yet)
            	String selectedItem = albumList.getSelectionModel().getSelectedItem();
            	
            	int index = -1;
            	for (int i = 0; i < currUser.albums.size(); i++) {
            	    Album album = currUser.albums.get(i);
            	    if (album.getAlbumName().equals(selectedItem)) {
            	    	index = i;
            	        break;
            	    }
            	}
             	if (index != -1) {
            	    currUser.albums.get(index).setAlbumName(name);
            	}
        		
        		// update backend data to file (save)
        		try {
					Privacy.serialize();
				} catch (IOException e) {
					// TODO Auto-generated catch block
					e.printStackTrace();
				}
        		
				loadAlbum();
				dialog.close();
				showMiniDialoge("Successful");
            }
        });
        
        // Set the action for the Cancel button
        cancelButton.setOnAction(event -> dialog.close());
        
        // Show the pop-up dialog
        dialog.showAndWait();
	}
	
	/**
	 Renames the folder at the given path, from its old name to the new name
	 @param oldName The original name of the folder
	 @param newName The new name of the folder
	 */
	public void renameFolder(String parentPath, String oldName, String newName) throws IOException {
	    Path oldPath = Paths.get(parentPath, oldName);
	    Path newPath = Paths.get(parentPath, newName);
	    /*
	    The Files.move() method in Java is used to move or rename a file or directory. It takes two parameters: the first parameter is the source path, which is the path of the file or directory to be moved or renamed, and the second parameter is the target path, which is the new path where the file or directory should be moved or renamed.
		The method moves the file or directory from the source path to the target path. If the target path is an existing directory, the source file or directory is moved into that directory. If the target path is a non-existing directory, a new directory is created with that name and the file or directory is moved into the new directory.
		If the source path and target path are on different file systems, the method will perform a copy operation followed by a delete operation.
	     * */
//	    
//	    The Files.move(source, target) method will move the file or directory located at the source path to the target path. If the target path is a directory, then the source directory and its contents will be moved into the target directory. If the target path is a file, an exception will be thrown.
//
//	    if you use Files.move(source, target) to rename a directory, it will move the entire directory and its contents from the source path to the target path, effectively renaming the directory.
	    if (Files.exists(oldPath) && Files.isDirectory(oldPath)) {
	        Files.move(oldPath, newPath);
	    }
	}

	/**
	 * Deletes the album selected
	 * @throws IOException When the album deletion encounter a error
	 * */
	public void deleteAlbum() throws IOException {
		// Check if we clicked on a album yet
		if(albumList.getSelectionModel().getSelectedIndex()<0) {
			Alert alertDialog = new Alert(AlertType.WARNING);
			alertDialog.initOwner(mainStage);
			alertDialog.setTitle("Delete warning");
			alertDialog.setHeaderText("Nothing is selected");
			alertDialog.setContentText("Please select a album before continuing to delete");
			alertDialog.showAndWait();
			return;
		}
		
		ButtonType confirm = new ButtonType("Confirm");
        ButtonType cancel = new ButtonType("Cancel");
		Alert dialog = new Alert(AlertType.WARNING,"Please confirm deletion",confirm,cancel);
        dialog.initOwner(mainStage);
        dialog.setHeaderText("Delete Album");
        dialog.setTitle("Confirmation required");
        Optional<ButtonType> result = dialog.showAndWait();
        if (result.get() != confirm) {
        	return;
        }
        
        // delete (first tries to move to trash)
        String selectedAlbum = albumList.getSelectionModel().getSelectedItem();        
        for (int i = 0; i < currUser.albums.size(); i++) {
            Album album = currUser.albums.get(i);
            if (album.getAlbumName().equals(selectedAlbum)) {
                currUser.albums.remove(i);
                break; // exit the loop since we found and removed the album
            }
        }
        String currentDir = System.getProperty("user.dir");
    	String storageDir = currentDir+"/src/photos/local/"+currUser.getUsername();
        tryDeleteFromFolder(storageDir,currUser);
        Privacy.serialize();

        
        loadAlbum();
	}
	
	/**

	Tries to delete photos from a given storage directory that do not belong to any album owned by the user.
	It first reads all photos from the directory, creates Photo objects for each photo, and adds them to a static list of all photos.
	Then it calls the static method findOrphan() of the Photo class to find photos that do not belong to any album owned by the user.
	If a photo does not belong to any album, it is deleted from the directory.
	@param storageDir the directory where the photos are stored
	@param user the user whose albums will be checked to see if they own the photos
	*/
	public void tryDeleteFromFolder(String storageDir, User user) {
		// tries to delete from folder, if no album own it
		File folder = new File(storageDir);
        Photo.allPhotos = new ArrayList<Photo>();
        File[] files = folder.listFiles();
        for (File file : files) {
            if (file.isFile()) {
                String fileName = file.getName();
                if (fileName.toLowerCase().endsWith(".bmp") ||
                        fileName.toLowerCase().endsWith(".gif") ||
                        fileName.toLowerCase().endsWith(".jpeg") ||
                        fileName.toLowerCase().endsWith(".png") ||
                        fileName.toLowerCase().endsWith(".jpg")) {
                    Photo p = new Photo(file.getAbsolutePath());

                    Photo.allPhotos.add(p);
                }
            }
        }
        Photo.findOrphan(user.getUsername());
	}
	 
	/**
	Deletes a file from the file system.
	@param filePath the path of the file to delete
	@return true if the file was successfully deleted, false otherwise
	*/
	public boolean deleteFile(String filePath) {
	    File file = new File(filePath);
	    return file.delete();
	 }
	
	/**
	Moves a file to the trash or the recycle bin. If moving the file fails, deletes the file.
	@param filePath the path of the file to move to the trash/recycle bin
	@return true if the file was successfully moved to the trash/recycle bin or deleted, false otherwise
	*/
	public boolean moveToTrash(String filePath) {
	  Path path = Paths.get(filePath);
	  try {
	    // Try to move to trash (works on macOS and Linux)
	    Files.move(path, Paths.get(System.getProperty("user.home"), ".Trash", path.getFileName().toString()));
	    return true;
	  } catch (Exception e) {
	    // If moving to trash fails, try to move to recycle bin (Windows only)
	    if (System.getProperty("os.name").toLowerCase().contains("win")) {
	      Path recycleBinPath = Paths.get(System.getProperty("user.home"), "AppData", "Local", "Microsoft", "Windows", "Recycle Bin");
	      try {
	        Files.move(path, Paths.get(recycleBinPath.toString(), path.getFileName().toString()));
	        return true;
	      } catch (Exception ex) {
	        // If moving to recycle bin fails, delete the file
	        boolean deleteSuccessful = deleteFile(filePath);
	        return deleteSuccessful;
	      }
	    } else {
	      // If not on Windows, delete the file
	      boolean deleteSuccessful = deleteFile(filePath);
	      return deleteSuccessful;
	    }
	  }
	}

	/**
	Opens the selected album and displays its contents in a new window.
	If no album is selected, a warning alert is displayed.
	@throws IOException if there is an error loading the album view FXML file.
	*/
	public void openAlbum() throws IOException {
		if(albumList.getSelectionModel().getSelectedIndex()<0) {
			Alert alertDialog = new Alert(AlertType.WARNING);
			alertDialog.initOwner(mainStage);
			alertDialog.setTitle("Open warning");
			alertDialog.setHeaderText("Nothing is selected");
			alertDialog.setContentText("Please select a album before continuing to open");
			alertDialog.showAndWait();
			return;
		}
		
		// Open
		Album selectedAlbum = null;
		String selectedItem = albumList.getSelectionModel().getSelectedItem();

		for (Album album : currUser.albums) {
		    if (album.getAlbumName().equals(selectedItem)) {
		        selectedAlbum = album;
		        break;
		    }
		}
		albumController.albumObj = selectedAlbum;
		albumController.user=currUser;
		SceneLoader.loadFXMLCenter("/photos/view/album.fxml", albumController.class,Pane.class,mainStage);
		albumList.removeEventHandler(MouseEvent.MOUSE_CLICKED, doubleClickHandler);
	}
	
	/**
	Logouts the current user and go back to the login screen
	@throws IOException if there is an error loading the login view FXML file.
	*/
	public void logoutHandler() throws IOException {
		ButtonType confirm = new ButtonType("Confirm");
        ButtonType cancel = new ButtonType("Cancel");
        
		Alert dialog = new Alert(AlertType.WARNING,"Please confirm your logout action",confirm,cancel);
        dialog.initOwner(mainStage);
        dialog.setHeaderText("Logout");
        dialog.setTitle("Confirmation required");
        Optional<ButtonType> result = dialog.showAndWait();
        if (result.get() != confirm) {
        	return;
        }
	    // Logout
        currUser = null;
        
        albumList.removeEventHandler(MouseEvent.MOUSE_CLICKED, doubleClickHandler);

        
		FXMLLoader loader = new FXMLLoader();
		loader.setLocation(getClass().getResource("/photos/view/login.fxml"));
		
		Pane root = (Pane)loader.load();
		
		LoginController controller = loader.getController();
		controller.setMainStage(mainStage);
	
		
		Scene scene = new Scene(root);
		mainStage.setScene(scene);
		mainStage.setResizable(false);
		mainStage.show();
	}
	
	/**
	 * Searches for photos in the current user's albums based on either a tag or a date range.
	 *
	 * @throws IOException if there is an issue with input or output
	 * @throws ParseException if there is an issue parsing the date
	 */
	public void searchPhoto() throws IOException, ParseException {
		
		// seach by tag or by date
		String method = searchMethod.getSelectionModel().getSelectedItem();
		
		
				
		if(method.equals("Tag")) {
			// tag name
			String target = searchTarget.getText().trim();
			if(target==null || target == ""||searchTarget.getText().isBlank()) {
				
				Alert alertDialog = new Alert(AlertType.WARNING);
				alertDialog.initOwner(mainStage);
				alertDialog.setTitle("Search warning");
				alertDialog.setHeaderText("Nothing is entered");
				alertDialog.setContentText("Please enter a tag");
				alertDialog.showAndWait();
				return;
			}
			
			// search by tag
			String[] splitTarget = target.split("AND|OR");
			boolean operationAND = target.contains("AND") ? true : false; // determine the operation
			String firstCondition = "";
			String secondCondition = "";
			if (splitTarget.length > 1) {
			    firstCondition = splitTarget[0].trim();
			    secondCondition = splitTarget[1].trim();
			} else {
			    firstCondition = target.trim();
			}

			// The container for the result
			Album tempAlbum = new Album("Search by Tags: " + target);

			// Loop through each album in the currUser object
			for (Album album : currUser.albums) {

			    // Loop through each photo in the album
			    for (Photo photo : album.getPhotos()) {

			        boolean meetsCondition = false;

			        // Loop through each tag of the photo
			        for (String tag : photo.getTags()) {
			        	
			            // Check if the tag matches the first or second condition
			            if ((operationAND && tag.equals(firstCondition) && photo.getTags().contains(secondCondition))
			                || (!operationAND && (tag.equals(firstCondition) || photo.getTags().contains(secondCondition)))) {
			                meetsCondition = true;
			                break; // no need to continue checking the remaining tags of this photo
			            }
			        }

			        if (meetsCondition) {
			            // If the photo meets the condition, add it to the result arraylist
			            tempAlbum.addPhoto(photo);
			        }
			    }
			}

			albumController.albumObj = tempAlbum;
			albumController.user=currUser;
			albumController.tempAlb=true;
			SceneLoader.loadFXMLCenter("/photos/view/album.fxml", albumController.class,Pane.class,mainStage);
			albumList.removeEventHandler(MouseEvent.MOUSE_CLICKED, doubleClickHandler);
		}else {
			// search by date range
			// Date formatter
			DateTimeFormatter formatter = DateTimeFormatter.ofPattern("MM/dd/yyyy");
			if( from.getValue()==null || to.getValue()==null) {
				
				Alert alertDialog = new Alert(AlertType.WARNING);
				alertDialog.initOwner(mainStage);
				alertDialog.setTitle("Search warning");
				alertDialog.setHeaderText("Invalid Date");
				alertDialog.setContentText("Please enter the proper date range");
				alertDialog.showAndWait();
				return;
			}
			// From date
			LocalDate selectedDate = from.getValue();
			String formattedDate = selectedDate.format(formatter);
			// To date
			LocalDate selectedDate2 = to.getValue();
			String formattedDate2 = selectedDate2.format(formatter);
			

			// search by date
			// The container for the result
			Album tempAlbum = new Album("Search by Date Range: "+formattedDate + " - " + formattedDate2);
			// Loop through each album in currUser
			for (Album album : currUser.albums) {
			    // Loop through each photo in the album
			    for (Photo photo : album.getPhotos()) {
			        // Get the modified date of the photo
			        String modifiedDateString = new Date(new File(System.getProperty("user.dir")+"/src/photos/local/"+currUser.getUsername()+File.separator+photo.getName()).lastModified()).toString();
			        try {
			            // Parse the modified date string into a Date object
			            SimpleDateFormat formatter1 = new SimpleDateFormat("EEE MMM dd HH:mm:ss zzz yyyy", Locale.US);
			            Date modifiedDate = formatter1.parse(modifiedDateString);
			            
			            // Convert the modified date to a Calendar object to manipulate it
			            Calendar cal = Calendar.getInstance();
			            cal.setTime(modifiedDate);
			            
			            // Parse the target date strings into Date objects
			            SimpleDateFormat targetFormatter = new SimpleDateFormat("MM/dd/yyyy");
			            Date fromDate = targetFormatter.parse(formattedDate);
			            Date toDate = targetFormatter.parse(formattedDate2);
			            
			            // Convert the start and end dates to Calendar objects to manipulate them
			            Calendar fromCal = Calendar.getInstance();
			            fromCal.setTime(fromDate);
			            Calendar toCal = Calendar.getInstance();
			            toCal.setTime(toDate);
			            
			            // Add a day to the end date to include the entire day
			            toCal.add(Calendar.DATE, 1);
			            
			            // Check if the photo's date is within the target range
			            if (cal.after(fromCal) && cal.before(toCal)) {
			                // If there's a match, append the photo to the result ArrayList
			                tempAlbum.addPhoto(photo);
			            }
			        } catch (ParseException e) {
			            // Handle the exception if the date string cannot be parsed
			            System.out.println("Error parsing date string: " + modifiedDateString);
			        }
			    }
			}


			albumController.albumObj = tempAlbum;
			albumController.user=currUser;
			albumController.tempAlb=true;
			SceneLoader.loadFXMLCenter("/photos/view/album.fxml", albumController.class,Pane.class,mainStage);
			albumList.removeEventHandler(MouseEvent.MOUSE_CLICKED, doubleClickHandler);
		}
		
	}
	
}