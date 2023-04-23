package photos.controller;

import javafx.collections.FXCollections;
import javafx.collections.ObservableList;
import javafx.fxml.FXML;
import javafx.fxml.FXMLLoader;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.Scene;
import javafx.scene.control.Alert;
import javafx.scene.control.Alert.AlertType;
import javafx.scene.control.Button;
import javafx.scene.control.ButtonType;
import javafx.scene.control.ComboBox;
import javafx.scene.control.Label;
import javafx.scene.control.TextField;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Pane;
import javafx.scene.layout.VBox;
import javafx.stage.Modality;
import javafx.stage.Stage;
import photos.utility.User;

import java.io.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

import photos.utility.Album;
import photos.utility.Privacy;
import photos.utility.SceneLoader;

/**
 * The controller for the main screen when logged in with a admin user, provides basic functionalities
 * @author Zihao Zheng , Yiming Huang
 * @since 4/13/23 
 */
public class AdminController implements Serializable{
	
	private static final long serialVersionUID = 1L;
	@FXML Label welcome;
	Stage mainStage;
	
	/**The current admin user that is logged in. Useful to identify itself when trying to delete users*/
	static User admin;
	
	/**
	Logs out the current user and displays the login page. A confirmation dialog is first displayed to confirm the action.
	If the user confirms the action, the login page is loaded and displayed. Otherwise, the method returns without doing anything.
	@throws IOException if there is an error loading the login page.
	*/
	public void logout() throws IOException {
		
		ButtonType confirm = new ButtonType("Confirm");
        ButtonType cancel = new ButtonType("Cancel");
        
		Alert dialog = new Alert(AlertType.WARNING,"You Cannot Undo This Action",confirm,cancel);
        dialog.initOwner(mainStage);
        dialog.setHeaderText("Are You Sure You Want to Logout?");
        dialog.setTitle("Confirm Action");
        Optional<ButtonType> result = dialog.showAndWait();
        if (result.get() != confirm) {
        	return;
        }
	     
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
	Loads the UserList.fxml file and displays it as a new scene.
	The UserListController class is used as the controller for this scene.
	@throws IOException if there is an error loading the FXML file
	*/
	public void viewUserList() throws IOException {
		  SceneLoader.loadFXML("/photos/view/UserList.fxml", UserListController.class,Pane.class,mainStage);
	}
	
	/**
	 * Creates a pop-up dialog window for creating a new user with a username, password, and type. If the user successfully
	 * enters a username and password, and the username does not already exist, a new user object is created, added to the
	 * backend, and serialized to the cloud. A new user space is also created on the local machine. If the user cancels the
	 * creation process or enters invalid input, the dialog window is closed without creating a new user object. After the
	 * creation process is complete, the user list view is updated.
	 *
	 * @throws IOException if an I/O error occurs when creating the new user space on the local machine or when serializing
	 *         the updated backend to the data file
	 */
	public void createUser() throws IOException {
		// Create the dialog layout
		Label usernameLabel = new Label("Username:");
		TextField usernameField = new TextField();
		Label passwordLabel = new Label("Password:");
		TextField passwordField = new TextField();
		Label typeLabel = new Label("Type:");
		ComboBox<String> typeComboBox = new ComboBox<>();
		// Load the combo box items
		ObservableList<String> options = FXCollections.observableArrayList(
		    "Administrator",
		    "Non-admin"
		);
		typeComboBox.setItems(options);
		typeComboBox.setValue(options.get(1)); // Set the first item as the default value
		typeComboBox.setValue(options.get(1)); // Set the first item as the default value
		HBox usernameBox = new HBox(10, usernameLabel, usernameField);
		HBox passwordBox = new HBox(10, passwordLabel, passwordField);
		HBox typeBox = new HBox(10, typeLabel, typeComboBox);
		Button confirmButton = new Button("Confirm");
		Button cancelButton = new Button("Cancel");
		HBox buttonBox = new HBox(10, confirmButton, cancelButton);
		VBox dialogBox = new VBox(10, usernameBox, passwordBox, typeBox, buttonBox);
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
            String username = usernameField.getText().trim();
            String password = passwordField.getText().trim();
            String type = typeComboBox.getSelectionModel().getSelectedItem();           

            
            if (username.isEmpty()|| password.isEmpty() ) {
                showMiniDialoge("The field cannot be empty!");
            } else if(username != null && checkExistence(username)) {
            	showMiniDialoge("User already exists");
            }else {
            	User u1 = new User(username, password, type);
	            u1.albums = new ArrayList<Album>();
	            try {
	            	//create the user space
					createFolder(System.getProperty("user.dir")+"/src/photos/local",u1.getUsername());
				} catch (IOException e1) {
					// TODO Auto-generated catch block
					e1.printStackTrace();
				}
            	Privacy.users.add(u1); // update the our backend
            	try {
					Privacy.serialize();// send backend to cloud
				} catch (IOException e) {
					// TODO Auto-generated catch block
					e.printStackTrace();
				}
				showMiniDialoge("Successful");
				dialog.close();
				try {
					SceneLoader.loadFXML("/photos/view/UserList.fxml", UserListController.class,Pane.class,mainStage);
				} catch (IOException e) {
					// TODO Auto-generated catch block
					e.printStackTrace();
				}
            }
            
        });
        
        // Set the action for the Cancel button
        cancelButton.setOnAction(event -> dialog.close());
        
        // Show the pop-up dialog
        dialog.showAndWait();
	}
	
	/**
	Creates a new folder with the specified name in the parent directory specified by parentPath.
	@param parentPath the path of the parent directory
	@param folderName the name of the folder to be created
	@throws IOException if there is an error creating the folder
	*/
	public static void createFolder(String parentPath, String folderName) throws IOException {
	    Path path = Paths.get(parentPath, folderName);
	    
	    //  creates the folder at the specified path if it doesn't already exist.
	    Files.createDirectories(path);
	}
	
	/**
	 * Checks if a user with the given username already exists in the Privacy system.
	 * 
	 * @param userName the username to check
	 * @return true if a user with the given username exists, false otherwise
	 */
	public boolean checkExistence(String userName) {
		for (int i = 0; i < Privacy.users.size(); i++) {
			if (Privacy.users.get(i).getUsername().equals(userName)) {
				return true;
			}
		}
		
		return false;
	}
	
	/**
	 * Displays a pop-up dialog box with a given message.
	 * The dialog box contains a single label with the message.
	 * The method blocks until the user closes the dialog box.
	 *
	 * @param message The message to display in the dialog box
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
	Opens a pop-up dialog window to prompt the user to enter a username to delete. If the username is found in the list
	of users, it is removed from the list and its associated folder is moved to the trash directory. The user is then
	redirected to the UserList view.
	@throws IOException if an I/O error occurs while serializing the user data
	*/
	public void deleteUser() throws IOException {
	    // Create the dialog layout
	    Label usernameLabel = new Label("Username:");
	    TextField usernameField = new TextField();
	    HBox usernameBox = new HBox(10, usernameLabel, usernameField);
	    Button confirmButton = new Button("Confirm");
	    Button cancelButton = new Button("Cancel");
	    HBox buttonBox = new HBox(10, confirmButton, cancelButton);
	    VBox dialogBox = new VBox(10, usernameBox, buttonBox);
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
	        String username = usernameField.getText().trim();

	        if (username.isEmpty()) {
	            showMiniDialoge("The field cannot be empty!");
	        } else {
	            User userToDelete = null;
	            for (User user : Privacy.users) {
	                if (user.getUsername().equals(username)) {
	                    userToDelete = user;
	                    break;
	                }
	            }

	            if (userToDelete == null) {
	                showMiniDialoge("User not found");
	            } else if (userToDelete.equals(admin)) {
	                showMiniDialoge("Cannot delete yourself");
	            } else {
	                Privacy.users.remove(userToDelete);
	                moveToTrash(System.getProperty("user.dir") + "/src/photos/local/" + userToDelete.getUsername());
	                try {
	                    Privacy.serialize();
	                } catch (IOException e) {
	                    e.printStackTrace();
	                }
	                showMiniDialoge("User deleted");
	                dialog.close();
	                try {
	                    SceneLoader.loadFXML("/photos/view/UserList.fxml", UserListController.class, Pane.class, mainStage);
	                } catch (IOException e) {
	                    e.printStackTrace();
	                }
	            }
	        }

	    });

	    // Set the action for the Cancel button
	    cancelButton.setOnAction(event -> dialog.close());

	    // Show the pop-up dialog
	    dialog.showAndWait();
	}

	/**
	Deletes a file from the file system.
	@param filePath the path of the file to be deleted
	@return true if the file was successfully deleted, false otherwise
	*/
	public boolean deleteFile(String filePath) {
		    File file = new File(filePath);
		    return file.delete();
	 }
	 
	/**
	Moves the file or directory at the specified path to the trash or recycle bin, depending on the operating system.
	If moving to trash or recycle bin fails, the file or directory is deleted.
	@param filePath the path of the file or directory to be moved to trash or recycle bin
	@return true if the file or directory was moved to trash or recycle bin or deleted successfully, false otherwise
	*/
	public boolean moveToTrash(String filePath) {
		    Path path = Paths.get(filePath);
		    try {
		        if (Files.isDirectory(path)) {
		            // If the file is a directory, recursively delete all its contents first
		            for (File file : path.toFile().listFiles()) {
		                moveToTrash(file.getAbsolutePath());
		            }
		        }
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
	Sets the main stage of the application and updates the welcome message to display the admin username.
	@param stage The main stage of the application.
	@throws IOException If an I/O error occurs.
	*/
	public void setMainStage(Stage stage) throws IOException{
		mainStage = stage;	
		welcome.setText("Welcome to Admin Portal, "+ admin.getUsername().toUpperCase());
	}
	
}