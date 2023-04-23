package photos.controller;

import java.io.File;
import java.io.IOException;
import java.io.Serializable;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.Optional;

import javafx.fxml.FXML;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.Node;
import javafx.scene.Scene;
import javafx.scene.control.*;
import javafx.scene.control.Alert.AlertType;
import javafx.scene.image.Image;
import javafx.scene.image.ImageView;
import javafx.scene.input.MouseEvent;
import javafx.scene.layout.GridPane;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Pane;
import javafx.scene.layout.Priority;
import javafx.scene.layout.VBox;
import javafx.stage.FileChooser;
import javafx.stage.Modality;
import javafx.stage.Stage;
import photos.utility.Album;
import photos.utility.Photo;
import photos.utility.Privacy;
import photos.utility.SceneLoader;
import photos.utility.User;
import photos.controller.*;
/**
 
 The album conroller class is the controller for the album.fxml in the view package. it provides the basic functionality the actions in the album state, which is the state the user enters after opening a specific album or a temporary no name album if the user searches by tag or date.
 @since 2023-04-13
 @author Zihao Zheng
 @author Yiming Huang
 */
public class albumController implements Serializable{

	private static final long serialVersionUID = 1L;
	Stage mainStage;
	public static Album albumObj=null;
	// Not the original user album list of photos. this is the verison without duplicated (for search)
	ArrayList<Photo> photosInAlbum;
	public static User user = null;
    String currentDir = System.getProperty("user.dir");
	String storageDir = currentDir+"/src/photos/local/"+user.getUsername();
	
	ArrayList<ImageView> imageViews = null;
	ArrayList<Label> imageCap = null;
	
	@FXML Button createAlbumButton;
	public static boolean tempAlb = false;
	
	int currStartIndex = 0;
	
	@FXML Pane ancestor;
	@FXML Button slideshowBTN;
	
    @FXML ImageView img1;
    @FXML ImageView img2;
    @FXML ImageView img3;
    @FXML ImageView img4;
    @FXML ImageView img5;
    @FXML ImageView img6;
    @FXML ImageView img7;
    @FXML ImageView img8;
    @FXML ImageView img9;
    
    @FXML Label one;
    @FXML Label two;
    @FXML Label three;
    @FXML Label four;
    @FXML Label five;
    @FXML Label six;
    @FXML Label seven;
    @FXML Label eight;
    @FXML Label nine;
    
    @FXML Button add;
    @FXML Button remove;
    @FXML Button move;
    @FXML Button copy;
    
    @FXML Pane imagesPane;
    @FXML Button next;
    @FXML Button prev;
    
    Photo selectedPhoto= null;
	
	@FXML Label welcome;
	@FXML ListView<String> photoList;
	
	/**
	Sets the main stage for the application and loads the appropriate images and buttons.
	@param stage The main stage of the application.
	@throws IOException if there is an error in the input or output of data.
	*/
	public void setMainStage(Stage stage) throws IOException{
		mainStage=stage;
		welcome.setWrapText(true);
		// Set the current album name
		if(albumObj!=null) {
			welcome.setText(albumObj.getAlbumName());
		}
		
		if(tempAlb==true) {
			// there is a chance that albumObj could contain samw image twice. remove that
			// Get the list of photos from the album
			ArrayList<Photo> orig = albumObj.getPhotos();
			// Use a HashSet to store the unique photos
			HashSet<Photo> uniquePhotos = new HashSet<>(orig);
			// Convert the HashSet back to an ArrayList
			photosInAlbum = new ArrayList<>(uniquePhotos);
		}else {
			photosInAlbum=albumObj.getPhotos();
		}

		
		if(tempAlb==true) {
			createAlbumButton.setDisable(false);
			createAlbumButton.setVisible(true);
			
			if(photosInAlbum.size()<=0) {
				createAlbumButton.setDisable(true);
			}
			
			add.setDisable(true);
			remove.setDisable(true);
			copy.setDisable(true);
			move.setDisable(true);
			
			
		}else {
			createAlbumButton.setDisable(true);
			createAlbumButton.setVisible(false);
			
		}
		
		// Gather the FXML objects
		imageViews = new ArrayList<>();
		imageViews.add(img1);
		imageViews.add(img2);
		imageViews.add(img3);
		imageViews.add(img4);
		imageViews.add(img5);
		imageViews.add(img6);
		imageViews.add(img7);
		imageViews.add(img8);
		imageViews.add(img9);
		
		imageCap = new ArrayList<>();
		imageCap.add(one);
		imageCap.add(two);
		imageCap.add(three);
		imageCap.add(four);
		imageCap.add(five);
		imageCap.add(six);
		imageCap.add(seven);
		imageCap.add(eight);
		imageCap.add(nine);

		containIV();
		// load the image in the album into the listview
		loadImages(0);
		
		// Determine if we need to disable the next/prev buttons
		if(currStartIndex <= 0) {
			// No previous page
			prev.setDisable(true);
		}
		if(currStartIndex+9>albumObj.getNumPhotos()-1) {
			// No next page
			next.setDisable(true);
		}
		if(currStartIndex-9>=0) {
			// Yes prev page
			prev.setDisable(false);
		}
		if(currStartIndex+9<=albumObj.getNumPhotos()-1) {
			// Yes next page
			next.setDisable(false);
		}
	}
	
	/**
	Sets the properties of the ImageViews to ensure proper scaling and smoothing of images.
	*/
	public void containIV() {
		if(imageViews!=null) {
			for(ImageView obj : imageViews) {
				obj.setPreserveRatio(false);
//				obj.setFitWidth(obj.getLayoutBounds().getWidth());
//				obj.setFitHeight(obj.getLayoutBounds().getHeight());
				
				obj.setFitWidth(280);
				obj.setFitHeight(177);
//				obj.setPreserveRatio(true);
				
				obj.setSmooth(true); // enable smoother image scaling
			}
		}
	}
	
	/**
	Handles the event of clicking on an ImageView by setting the opacity of the selected ImageView to 0.7
	and setting the selected photo to the corresponding photo object.
	@param event The MouseEvent that triggered the method.
	*/
	public void imageViewClicked(MouseEvent event) {
	    ImageView clickedImageView = (ImageView) event.getSource();
	    if(clickedImageView.getImage()==null) {
	        return;
	    }
	    String imagePath = clickedImageView.getImage().getUrl();
	    String imageName = imagePath.substring(imagePath.lastIndexOf("/") + 1);
	    for (Node node : imagesPane.getChildren()) {
	        if (node instanceof ImageView) {
	            ImageView imageView = (ImageView) node;
	            if (imageView == clickedImageView) {
	                imageView.setOpacity(0.5);
	                for (Photo photo : photosInAlbum) {
	                    if (photo.getName().equals(imageName)) {
	                        selectedPhoto = photo;
	                        break;
	                    }
	                }
	            } else {
	                imageView.setOpacity(1.0);
	            }
	        }
	    }
	    // 防止冒泡
	    event.consume();
	}

	/**
	Resets the selected photo to null and sets the opacity of all ImageViews in the imagesPane to 1.0.
	*/
	public void paneClicked() {
		selectedPhoto= null;
		for (Node node : imagesPane.getChildren()) {
	        if (node instanceof ImageView) {
	        	ImageView imageView = (ImageView) node;
	        	imageView.setOpacity(1.0);
	        }
	    }
		return;
	}

	/**
	Logs the user out of the application by setting the albumObj, user, and photosInAlbum fields to null
	and loading the non-admin view using the mainStage.
	@throws IOException if the FXML file cannot be loaded.
	*/
	public void logoutHandler() throws IOException {
		albumObj = null;
		user = null;
		this.photosInAlbum=null;
		tempAlb=false;
		SceneLoader.loadFXML("/photos/view/nonAdmin.fxml", nonAdminController.class,Pane.class,mainStage);
	}
	
	/**
	Loads the images of the current album onto the GUI, starting from the given startIndex.
	Displays up to 9 thumbnails at a time.
	@param startIndex The index of the first photo to display.
	*/
	public void loadImages(int startIndex) {
		currStartIndex = startIndex;
		for(int i=0;i<9;i++) {
			//reset
			imageViews.get(i).setImage(null);
			imageCap.get(i).setText("");
		}
		
		
		if(photosInAlbum.size()<=0 || photosInAlbum==null) {
			slideshowBTN.setDisable(true);
		}else {
			slideshowBTN.setDisable(false);
		}
		int thumbnailIndex = 0;

		for(int i=startIndex;i<=startIndex+8;i++) {
			if(photosInAlbum.size() == i) {
				// if we reach end of the total photos, stop rendering
				break;
			}
			Photo photoObj = photosInAlbum.get(i);
			imageViews.get(thumbnailIndex).setImage(new Image(new File(storageDir+File.separator+photoObj.getName()).toURI().toString()));
			imageCap.get(thumbnailIndex).setText(photoObj.getCaption());
			thumbnailIndex++;
			
			paneClicked();
			if(currStartIndex <= 0) {
				// No previous page
				prev.setDisable(true);
			}
			if(currStartIndex+9>albumObj.getNumPhotos()-1) {
				// No next page
				next.setDisable(true);
			}
			if(currStartIndex-9>=0) {
				// Yes prev page
				prev.setDisable(false);
			}
			if(currStartIndex+9<=albumObj.getNumPhotos()-1) {
				// Yes next page
				next.setDisable(false);
			}
		}
	}
	
	/**
	Method to add a photo to the album.
	Opens a file chooser dialog to select the photo file.
	Copies the file to the destination directory and updates the album.
	@throws IOException if an I/O error occurs during file operations.
	*/
	public void addPhoto() throws IOException {
		// Create an empty stage.
		Stage stage = new Stage();
		// Create a file chooser.
		FileChooser fileChooser = new FileChooser();
		// Set the main stage as the parent of the empty stage.
		stage.initOwner(mainStage);
		// Set the empty stage to be a modal dialog.
		stage.initModality(Modality.APPLICATION_MODAL);
		// Disable the main stage so that it can't be interacted with while the file chooser is open.
		mainStage.getScene().getRoot().setDisable(true);
		// Open the file chooser on the empty stage.
		File selectedFile = fileChooser.showOpenDialog(stage);
		// Re-enable the main stage.
		mainStage.getScene().getRoot().setDisable(false);

        if (selectedFile != null) {
            String targetFile = selectedFile.getAbsolutePath();
            // Do something with the file path here 
            // Copy the file to the destination directory
            File source = new File(targetFile);
            File destination = new File(storageDir + File.separator + source.getName());
            
            boolean photoExists = false;
            ArrayList<Photo> photos = photosInAlbum;
            for (Photo photo : photos) {
                if (photo.getName().equals(source.getName())) {
                	photoExists = true;
                    break;
                }
            }
            if(photoExists) {
            	// Photo Exists in Album
            	Alert alertDialog = new Alert(AlertType.WARNING);
    			alertDialog.initOwner(mainStage);
    			alertDialog.setTitle("Copy failed");
    			alertDialog.setHeaderText("Photo already exists in album");
    			alertDialog.setContentText("Action Canceled.\nYou may safely close thise window");
    			alertDialog.showAndWait();
    			return;
            }
        	
            
            if(source.getName().toLowerCase().endsWith(".jpg")||source.getName().toLowerCase().endsWith(".png")||source.getName().toLowerCase().endsWith(".jpeg")||source.getName().toLowerCase().endsWith(".bmp")||source.getName().toLowerCase().endsWith(".gif")) {
            	boolean existInFolder = false;
            	// check if it exists in the folder, if so then bring it here
                File directory = new File(storageDir);
                File[] files = directory.listFiles();
                for (File file : files) {
                    if (file.isFile()) {
                        String fileName = file.getName();
                        if (fileName.equals(source.getName())) {
                        	// Already Exists
                        	existInFolder=true;
                        	break;
                        }
                    }
                }
            	
            	if(existInFolder) {
            		// This = That
            		Photo a1 = null;
            		for (Album album : user.albums) {
            	        for (Photo photo : album.getPhotos()) {
            	            if (photo.getName().equals(source.getName())) {
            	            	a1= photo;
            	                break;
            	            }
            	        }
            	    }
            		
                	
                    photosInAlbum.add(a1);// update backend
                    loadImages(currStartIndex);// update front end
                    Privacy.serialize();//upload to cloud
            	}else {
            		try {
                        Files.copy(source.toPath(), destination.toPath(), StandardCopyOption.REPLACE_EXISTING);
                        destination.setLastModified(source.lastModified());
                        Alert alertDialog = new Alert(AlertType.INFORMATION);
            			alertDialog.initOwner(mainStage);
            			alertDialog.setTitle("Sucessfully Copied");
            			alertDialog.setHeaderText("File copied successfully to " + destination.getPath());
            			alertDialog.setContentText("You may safely close thise window");
            			alertDialog.showAndWait();
            			
                    } catch (IOException e) {
                        Alert alertDialog = new Alert(AlertType.WARNING);
            			alertDialog.initOwner(mainStage);
            			alertDialog.setTitle("Copy failed");
            			alertDialog.setHeaderText("Copy Unsucessful");
            			alertDialog.setContentText("You may safely close this window");
            			alertDialog.showAndWait();
                    }
            		Photo a1 = new Photo(destination.getPath());
                	
                    albumObj.addPhoto(a1);// update backend
                    loadImages(currStartIndex);// update front end
                    Privacy.serialize();//upload to cloud
            	}
            	
            	
            }else {
            	Alert alertDialog = new Alert(AlertType.WARNING);
    			alertDialog.initOwner(mainStage);
    			alertDialog.setTitle("Copy failed");
    			alertDialog.setHeaderText("Invalid type of photo");
    			alertDialog.setContentText("Valid Formats: JPG, JPEG, GIF, PNG");
    			alertDialog.showAndWait();
    			return;
            }
            
        }else {
        	Alert alertDialog = new Alert(AlertType.WARNING);
			alertDialog.initOwner(mainStage);
			alertDialog.setTitle("Selection failed");
			alertDialog.setHeaderText("You did not select any file");
			alertDialog.setContentText("You may safely close thise window");
			alertDialog.showAndWait();

        }
	}
	
	/**
	Displays a mini dialogue box with the given message.
	The dialogue box is a modal dialog box, meaning that the user
	cannot interact with the main stage until the dialogue box is closed.
	@param message the message to be displayed in the dialogue box
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
	Allows the user to add or edit a caption for the selected photo. If no photo is selected, displays an error message and exits the function.
	If the selected photo already has a caption, the previous caption is loaded into the text field of the dialog.
	The function creates a dialog window containing a label, a text field for entering the caption, and two buttons, "Confirm" and "Cancel".
	The "Confirm" button saves the entered caption to the backend and updates the front end to display the caption. The function also attempts
	to upload the updated privacy settings to a cloud service. The "Cancel" button closes the dialog window without saving any changes.
	This function disables the main window while the dialog is open and re-enables it when the dialog is closed.
	*/
	public void capPhoto() {
		// Check selection
		if(selectedPhoto==null) {
			Alert alertDialog = new Alert(AlertType.WARNING);
			alertDialog.initOwner(mainStage);
			alertDialog.setTitle("Delete warning");
			alertDialog.setHeaderText("Nothing is selected");
			alertDialog.setContentText("Please select a photo before continuing to remove");
			alertDialog.showAndWait();
			return;
		}
		//Load previous caption
		String prevCap = selectedPhoto.getCaption()!=null ? selectedPhoto.getCaption() : null;
		
		
		// Create the dialog layout
        Label titleLabel = new Label("Caption: ");
        TextField nameField = new TextField();
        if(prevCap!=null) nameField.setText(prevCap);
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
            selectedPhoto.setCaption(name);//backend
            loadImages(currStartIndex);//front end
            try {
				Privacy.serialize();
			} catch (IOException e) {
				// TODO Auto-generated catch block
				e.printStackTrace();
			}//upload to cloud
			dialog.close();
        });
        
        // Set the action for the Cancel button
        cancelButton.setOnAction(event -> dialog.close());
        
        // Show the pop-up dialog
        dialog.showAndWait();
		
	}
	
	/**
	Allows the user to remove the selected photo from the album. If no photo is selected, displays an error message and exits the function.
	The function prompts the user to confirm the deletion by displaying a pop-up dialog window containing "Confirm" and "Cancel" buttons.
	If the user clicks "Cancel", the function exits without deleting the photo. If the user clicks "Confirm", the function deletes the photo
	from the album object and from the local folder, if it exists. The function updates the front end to remove the deleted photo and attempts
	to upload the updated data to local folder
	@throws IOException if an error occurs while attempting to delete the photo from the local folder
	*/
	public void removePhoto() throws IOException {
		if(selectedPhoto==null) {
			Alert alertDialog = new Alert(AlertType.WARNING);
			alertDialog.initOwner(mainStage);
			alertDialog.setTitle("Delete warning");
			alertDialog.setHeaderText("Nothing is selected");
			alertDialog.setContentText("Please select a photo before continuing to remove");
			alertDialog.showAndWait();
			return;
		}
		
		// remove photo from album
		String selectedPhoto = this.selectedPhoto.getName();
		ButtonType confirm = new ButtonType("Confirm");
        ButtonType cancel = new ButtonType("Cancel");
		Alert dialog = new Alert(AlertType.WARNING,"Please confirm deletion",confirm,cancel);
        dialog.initOwner(mainStage);
        dialog.setHeaderText("Removing "+selectedPhoto+" from album");
        dialog.setTitle("Confirmation required");
        Optional<ButtonType> result = dialog.showAndWait();
        if (result.get() != confirm) {
        	return;
        }
        
        
        albumObj.removePhoto(this.selectedPhoto);
        this.selectedPhoto = null;
        
        tryDeleteFromFolder();

        
        loadImages(0);//front end
        Privacy.serialize();//upload to cloud
	}
	
	/**
	Attempts to delete the selected photo from the local folder. If the photo is not associated with any album, it is considered an orphan
	and may be deleted from the local folder. This function reads all image files in the local storage directory and creates Photo objects
	for each image. If a Photo object is not associated with any album, it is added to the Photo.allPhotos list. The function then calls
	the Photo.findOrphan() function to determine if the selected photo is an orphan. If it is, the function removes the file from the local
	folder. If the photo is associated with an album, it cannot be deleted from the local folder and this function has no effect.
	*/
	public void tryDeleteFromFolder() {
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
	This function loads the non-admin FXML file and sets it as the new scene on the main stage, effectively returning the user to the non-admin
	view of the photo album.
	@throws IOException if there is an error loading the FXML file or setting the new scene on the main stage
	*/
	public void back() throws IOException {
		SceneLoader.loadFXML("/photos/view/nonAdmin.fxml", nonAdminController.class,Pane.class,mainStage);
	}

	/**
	This function loads the slideshow FXML file and sets it as the new scene on the main stage, displaying the selected album's photos as a slideshow.
	@throws IOException if there is an error loading the FXML file or setting the new scene on the main stage
	*/
	public void slideshow() throws IOException {
		SceneLoader.loadFXMLCenter("/photos/view/slideshow.fxml", slideshowController.class,Pane.class,mainStage);
	}
	
	/**
	Loads the previous page of photos in the album, with a maximum of 9 photos per page.
	Disables the "previous" button if there is no previous page, and enables it otherwise.
	Disables the "next" button if there is no next page, and enables it otherwise.
	*/
	public void prevPage() {
		int prevStartIndex= currStartIndex-9;
		// Go to prev page
		loadImages(prevStartIndex);
		
		// Determine if we need to disable the next/prev buttons
		if(currStartIndex <= 0) {
			// No previous page
			prev.setDisable(true);
		}
		if(currStartIndex+9>albumObj.getNumPhotos()-1) {
			// No next page
			next.setDisable(true);
		}
		if(currStartIndex-9>=0) {
			// Yes prev page
			prev.setDisable(false);
		}
		if(currStartIndex+9<=albumObj.getNumPhotos()-1) {
			// Yes next page
			next.setDisable(false);
		}
	}
	
	/**
	Loads the next page of photos and updates the pagination buttons accordingly.
	If the current page is the last page, the next button will be disabled.
	If the current page is not the first page, the previous button will be enabled.
	*/
	public void nextPage() {
		int nextStartIndex= currStartIndex+9;
		// Go to next page
		loadImages(nextStartIndex);
		
		// Determine if we need to disable the next/prev buttons
		if(currStartIndex <= 0) {
			// No previous page
			prev.setDisable(true);
		}
		if(currStartIndex+9>albumObj.getNumPhotos()-1) {
			// No next page
			next.setDisable(true);
		}
		if(currStartIndex-9>=0) {
			// Yes prev page
			prev.setDisable(false);
		}
		if(currStartIndex+9<=albumObj.getNumPhotos()-1) {
			// Yes next page
			next.setDisable(false);
		}

	}

	
	/**
	Displays a dialog box to add a new tag to a selected photo.
	If no photo is selected, a warning message is displayed.
	The user can enter a new tag name and value in TextFields.
	The dialog also displays the current tags of the selected photo.
	If the user confirms the addition of the new tag, the tag is added to the selected photo
	and the updated photo collection is serialized.
	If the tag name or value contains illegal characters ('=' or 'AND' or 'OR'), a warning message is displayed
	and the new tag is not added.
	If the tag already exists in the selected photo, a warning message is displayed
	and the new tag is not added.
	*/
	public void addTag() {
		// Check selection
		if(selectedPhoto==null) {
			Alert alertDialog = new Alert(AlertType.WARNING);
			alertDialog.initOwner(mainStage);
			alertDialog.setTitle("Delete warning");
			alertDialog.setHeaderText("Nothing is selected");
			alertDialog.setContentText("Please select a photo before continuing to remove");
			alertDialog.showAndWait();
			return;
		}
		
		// Create a VBox to hold the dialog content
		VBox dialogBox = new VBox();
		dialogBox.setPadding(new Insets(10));
		dialogBox.setSpacing(10);

		// Create a Label to display "Your Tags"
		Label yourTagsLabel = new Label("Your Tags");
		yourTagsLabel.setStyle("-fx-font-size: 16px; -fx-font-weight: bold;");

		// Create an empty Label to display the selectedPhoto's tags
		Label selectedPhotoTagsLabel = new Label();
		selectedPhotoTagsLabel.setWrapText(true);
		// Add the yourTagsLabel to the VBox
		dialogBox.getChildren().add(yourTagsLabel);

		// Add the selectedPhotoTagsLabel to the VBox, after yourTagsLabel
		dialogBox.getChildren().add(selectedPhotoTagsLabel);

		// Create a GridPane to hold the "New Tag" Label and TextField
		GridPane newTagGrid = new GridPane();
		newTagGrid.setHgap(10);
		newTagGrid.setVgap(10);

		// Create a Label to display "New Tag Name:"
		Label newTagNameLabel = new Label("Tag Name:");
		newTagGrid.add(newTagNameLabel, 0, 0);

		// Create a TextField for the user to enter a new tag name
		TextField newTagNameTextField = new TextField();
		newTagGrid.add(newTagNameTextField, 1, 0);

		// Create a Label to display "Tag Value:"
		Label newTagValueLabel = new Label("Tag Value:");
		newTagGrid.add(newTagValueLabel, 0, 1);

		// Create a TextField for the user to enter a new tag value
		TextField newTagValueTextField = new TextField();
		newTagGrid.add(newTagValueTextField, 1, 1);

		dialogBox.getChildren().add(newTagGrid);

		// Add the selectedPhoto's tags to the empty Label
		ArrayList<String> tags = selectedPhoto.getTags();
		if (!tags.isEmpty()) {
		    selectedPhotoTagsLabel.setText(String.join(",", tags));
		} else {
		    dialogBox.getChildren().remove(yourTagsLabel);
		}

		// Create a HBox to hold the confirm and delete buttons
		HBox buttonBox = new HBox();
		buttonBox.setSpacing(10);

		// Create a Confirm button
		Button confirmButton = new Button("Confirm");

		// Create a Cancel button
		Button cancelButton = new Button("Cancel");

		buttonBox.getChildren().addAll(confirmButton, cancelButton);
		dialogBox.getChildren().add(buttonBox);

		// Create a new Scene with the VBox as the root node
		Scene dialogScene = new Scene(dialogBox, 400, 200);

		// Create a new Stage for the dialog
		Stage dialog = new Stage();
		confirmButton.setOnAction(e -> {
		    String newTagName = newTagNameTextField.getText();
		    String newTagValue = newTagValueTextField.getText();
		    String newTag = newTagName + "=" + newTagValue;
		    boolean tagExists = false;
		    for (String tag : selectedPhoto.getTags()) {
		        if (tag.equals(newTag)) {
		            tagExists = true;
		            break;
		        }
		    }
		    if(newTagNameTextField.getText().isEmpty()||newTagValueTextField.getText().isEmpty()) {
		    	showMiniDialoge("Fields cannot be emtpy");
		    	return;
		    }
		    if(newTagName.contains("=")||newTagValue.contains("=")){
		    	showMiniDialoge("Illegal character in tag name or tag value : '='");
		    	return;
		    }
		    if(newTagName.contains("AND")||newTagValue.contains("AND")){
		    	showMiniDialoge("Illegal character in tag name or tag value : 'AND'");
		    	return;
		    }
		    if(newTagName.contains("OR")||newTagValue.contains("OR")){
		    	showMiniDialoge("Illegal character in tag name or tag value : 'OR'");
		    	return;
		    }
		    if (tagExists) {
		        showMiniDialoge("Tag already exists");
		    } else {
		        selectedPhoto.addTag(newTag);
		        try {
		            Privacy.serialize();
		        } catch (IOException e1) {
		            // TODO Auto-generated catch block
		            e1.printStackTrace();
		        }
		        dialog.close();
		    }
		});
		cancelButton.setOnAction(e -> dialog.close());
		dialog.initModality(Modality.WINDOW_MODAL);
		dialog.initOwner(mainStage);
		dialog.setScene(dialogScene);
		dialog.showAndWait();




	}
	
	/**
	Displays a dialog box for the user to select which tag to delete from the currently selected photo.
	If no photo is selected, a warning dialog is displayed. If the selected photo has no tags,
	a different warning dialog is displayed.
	The selected tag(s) are then removed from the photo's list of tags, and the Privacy object
	is serialized to save the changes.
	*/
	public void deleteTag() {
		if(selectedPhoto==null) {
			Alert alertDialog = new Alert(AlertType.WARNING);
			alertDialog.initOwner(mainStage);
			alertDialog.setTitle("Delete warning");
			alertDialog.setHeaderText("Nothing is selected");
			alertDialog.setContentText("Please select a photo before continuing to remove");
			alertDialog.showAndWait();
			return;
		}else if(selectedPhoto.getTags().size()<=0) {
			Alert alertDialog = new Alert(AlertType.WARNING);
			alertDialog.initOwner(mainStage);
			alertDialog.setTitle("Tag warning");
			alertDialog.setHeaderText("No tag to delete");
			alertDialog.setContentText("Why not add a tag?");
			alertDialog.showAndWait();
			return;
		}
		
		// Create a VBox to hold the dialog content
		VBox dialogBox = new VBox();
		dialogBox.setPadding(new Insets(10));
		dialogBox.setSpacing(10);

		// Create a Label to display "Select the tag to delete"
		Label selectTagLabel = new Label("Select the tag to delete");
		selectTagLabel.setStyle("-fx-font-size: 16px; -fx-font-weight: bold;");
		dialogBox.getChildren().add(selectTagLabel);

		// Create a VBox to hold the checkboxes for each tag
		VBox tagCheckboxBox = new VBox();
		tagCheckboxBox.setSpacing(5);

		// Get the tags for the selected photo
		ArrayList<String> selectedPhotoTags = selectedPhoto.getTags();

		// Create a checkbox for each tag
		for (String tag : selectedPhotoTags) {
		    CheckBox tagCheckbox = new CheckBox(tag);
		    tagCheckboxBox.getChildren().add(tagCheckbox);
		}

		dialogBox.getChildren().add(tagCheckboxBox);

		// Create a HBox to hold the confirm and delete buttons
		HBox buttonBox = new HBox();
		buttonBox.setSpacing(10);

		// Create a Confirm button
		Button confirmButton = new Button("Confirm");

		// Create a Delete button
		Button cancelButton = new Button("Cancel");

		buttonBox.getChildren().addAll(confirmButton, cancelButton);
		dialogBox.getChildren().add(buttonBox);

		// Create a new Scene with the VBox as the root node
		Scene dialogScene = new Scene(dialogBox, 300, 200);

		// Create a new Stage for the dialog
		Stage dialog = new Stage();
		cancelButton.setOnAction(e -> dialog.close());
		confirmButton.setOnAction(e -> {
			boolean atLeastOne = false;
		    // Loop through the checkboxes and remove the selected tag
		    for (Node node : tagCheckboxBox.getChildren()) {
		        if (node instanceof CheckBox) {
		            CheckBox checkbox = (CheckBox) node;
		            if (checkbox.isSelected()) {
		                selectedPhoto.removeTag(checkbox.getText());
		                atLeastOne= true;
		            }
		        }
		    }
		    if(atLeastOne == false) {
		    	showMiniDialoge("No Tag Selected");
		    }else {
		    	if(tempAlb=true) {
		    		
		    	}
		    	try {
					Privacy.serialize();
				} catch (IOException e1) {
					// TODO Auto-generated catch block
					e1.printStackTrace();
				}
			    dialog.close();
		    }
		    
		});

		dialog.initModality(Modality.WINDOW_MODAL);
		dialog.initOwner(mainStage);
		dialog.setScene(dialogScene);
		dialog.showAndWait();

		
		
	}
	
	/**
	* Moves the selected photo from the source album to the destination album.
	*/
	public void movePhoto() {
		if(selectedPhoto==null) {
			Alert alertDialog = new Alert(AlertType.WARNING);
			alertDialog.initOwner(mainStage);
			alertDialog.setTitle("Copy warning");
			alertDialog.setHeaderText("Nothing is selected");
			alertDialog.setContentText("Please select a photo before continuing to copy");
			alertDialog.showAndWait();
			return;
		}
		
		
		
		// Create the dialog layout
        Label titleLabel = new Label("Enter the name of the album to move to: ");
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
//        dialog.setOnShowing(event -> mainStage.setOpacity(0.7));
//        dialog.setOnHidden(event -> mainStage.setOpacity(1));
        
        // Set the action for the Confirm button
        confirmButton.setOnAction(event -> {
            String name = nameField.getText().trim();
            boolean albumExists = false;
            boolean photoExists = false;

            // Loop through each album in user
            for (Album album : user.albums) {
                // Check if the album name matches the target name
                if (album.getAlbumName().equals(name)) {
                    albumExists = true;
                    // Loop through each photo in the album
                    for (Photo photo : album.getPhotos()) {
                        // Check if the photo name matches the selected photo's name
                        if (photo.getName().equals(selectedPhoto.getName())) {
                            photoExists = true;
                            break;
                        }
                    }
                    // If the photo already exists, show mini dialog and return
                    if (photoExists) {
                        showMiniDialoge("Photo already exists in album");
                        return;
                    }
                    // If the album exists but the photo does not, append the selected photo
                    album.addPhoto(selectedPhoto);
                    photosInAlbum.remove(selectedPhoto);
                    selectedPhoto=null;
                    loadImages(0);
                    showMiniDialoge("Photo moved to album successfully");
                    try {
						Privacy.serialize();
					} catch (IOException e) {
						// TODO Auto-generated catch block
						e.printStackTrace();
					}
                    dialog.close();
                    return;
                }
            }
            // If the album does not exist, show mini dialog and return
            if (!albumExists) {
                showMiniDialoge("Album does not exist");
                return;
            }
        });

        
        // Set the action for the Cancel button
        cancelButton.setOnAction(event -> dialog.close());
        
        // Show the pop-up dialog
        dialog.showAndWait();
	}
	
	/**
	 * Copies the selected photo from one album to another 
	 */
	public void copyPhoto() {
		if(selectedPhoto==null) {
			Alert alertDialog = new Alert(AlertType.WARNING);
			alertDialog.initOwner(mainStage);
			alertDialog.setTitle("Copy warning");
			alertDialog.setHeaderText("Nothing is selected");
			alertDialog.setContentText("Please select a photo before continuing to copy");
			alertDialog.showAndWait();
			return;
		}
		
		
		
		// Create the dialog layout
        Label titleLabel = new Label("Enter the name of the album to move to: ");
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
//        dialog.setOnShowing(event -> mainStage.setOpacity(0.7));
//        dialog.setOnHidden(event -> mainStage.setOpacity(1));
        
        // Set the action for the Confirm button
        confirmButton.setOnAction(event -> {
            String name = nameField.getText().trim();
            boolean albumExists = false;
            boolean photoExists = false;

            // Loop through each album in user
            for (Album album : user.albums) {
                // Check if the album name matches the target name
                if (album.getAlbumName().equals(name)) {
                    albumExists = true;
                    // Loop through each photo in the album
                    for (Photo photo : album.getPhotos()) {
                        // Check if the photo name matches the selected photo's name
                        if (photo.getName().equals(selectedPhoto.getName())) {
                            photoExists = true;
                            break;
                        }
                    }
                    // If the photo already exists, show mini dialog and return
                    if (photoExists) {
                        showMiniDialoge("Photo already exists in album");
                        return;
                    }
                    // If the album exists but the photo does not, append the selected photo
                    album.addPhoto(selectedPhoto);
                    showMiniDialoge("Photo added to album successfully");
                    try {
						Privacy.serialize();
					} catch (IOException e) {
						// TODO Auto-generated catch block
						e.printStackTrace();
					}
                    dialog.close();
                    return;
                }
            }
            // If the album does not exist, show mini dialog and return
            if (!albumExists) {
                showMiniDialoge("Album does not exist");
                return;
            }
        });

        
        // Set the action for the Cancel button
        cancelButton.setOnAction(event -> dialog.close());
        
        // Show the pop-up dialog
        dialog.showAndWait();
	}
	
	/**
	 * Displays the selected photo in a seperate display area
	 */
	public void displayPhoto() {
		if(selectedPhoto==null) {
			Alert alertDialog = new Alert(AlertType.WARNING);
			alertDialog.initOwner(mainStage);
			alertDialog.setTitle("Display warning");
			alertDialog.setHeaderText("Nothing is selected");
			alertDialog.setContentText("Please select a photo before continuing to display");
			alertDialog.showAndWait();
			return;
		}
		
		// Create a new Stage for the photo display
		Stage photoStage = new Stage();
		photoStage.setTitle("Photo Display");

		// Create a VBox to hold the photo display content
		VBox photoBox = new VBox();
		photoBox.setPadding(new Insets(10));
		photoBox.setSpacing(10);

		// Set VBox to grow in both directions
		VBox.setVgrow(photoBox, Priority.ALWAYS);

		// Create an HBox to hold the left and right sections
		HBox sectionsBox = new HBox();
		sectionsBox.setSpacing(10);

		// Set HBox to grow in both directions
		HBox.setHgrow(sectionsBox, Priority.ALWAYS);

		// Create a Pane to hold the ImageView
		Pane imageViewPane = new Pane();
		imageViewPane.setMinSize(400, 400);
		imageViewPane.setMaxSize(Double.MAX_VALUE, Double.MAX_VALUE);

		ImageView imageView = new ImageView(new File(storageDir+File.separator+selectedPhoto.getName()).toURI().toString());
		imageView.setPreserveRatio(true);
		imageView.setFitWidth(400);

		// Set ImageView to grow in both directions
		HBox.setHgrow(imageView, Priority.ALWAYS);
		VBox.setVgrow(imageView, Priority.ALWAYS);

		imageViewPane.getChildren().add(imageView);

		// Create a VBox to hold the photo details sections
		VBox detailsBox = new VBox();
		detailsBox.setSpacing(10);
		detailsBox.setPrefWidth(150);

		// Set VBox to grow in both directions
		VBox.setVgrow(detailsBox, Priority.ALWAYS);

		// Create the Photo Name section
		Label photoNameLabel = new Label("Photo Name:");
		Label photoNameDetails = new Label(selectedPhoto.getName());
		photoNameDetails.setWrapText(true);
		VBox photoNameBox = new VBox(photoNameLabel, photoNameDetails);
		photoNameBox.setSpacing(5);
		detailsBox.getChildren().add(photoNameBox);

		// Create the Tags section
		Label tagsLabel = new Label("Tags:");
		Label tagsDetails = new Label(String.join(", ", selectedPhoto.getTags()));
		tagsDetails.setWrapText(true);
		VBox tagsBox = new VBox(tagsLabel, tagsDetails);
		tagsBox.setSpacing(5);
		detailsBox.getChildren().add(tagsBox);

		// Create the Caption section
		Label captionLabel = new Label("Caption:");
		Label captionDetails = new Label(selectedPhoto.getCaption());
		captionDetails.setWrapText(true);
		VBox captionBox = new VBox(captionLabel, captionDetails);
		captionBox.setSpacing(5);
		detailsBox.getChildren().add(captionBox);

		// Create the Capture Date section
		Label captureDateLabel = new Label("Capture Date:");
		File photoFile = new File(storageDir+File.separator+selectedPhoto.getName());
		Label captureDateDetails = new Label(new Date(photoFile.lastModified()).toString());
		captureDateDetails.setWrapText(true);
		VBox captureDateBox = new VBox(captureDateLabel, captureDateDetails);
		captureDateBox.setSpacing(5);
		detailsBox.getChildren().add(captureDateBox);

		// Add the ImageView and details sections to the sectionsBox
		sectionsBox.getChildren().addAll(imageViewPane, detailsBox);

		// Add the sectionsBox to the photoBox
		photoBox.getChildren().add(sectionsBox);

		// Create a new Scene with the photoBox as the root node
		Scene photoScene = new Scene(photoBox);

		// Set the photoStage scene to the photoScene and show the stage
		photoStage.setScene(photoScene);
		photoStage.initOwner(mainStage);
//		photoStage.initModality(Modality.APPLICATION_MODAL);
		photoStage.showAndWait();

	}

	/**
	 * Creates an album for the current set of photos. Only use when searching for a specific set of photos
	 */
	public void createAlbum() {
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
                	if(user.albums==null || user.albums.size()<=0) user.albums=new ArrayList<Album>();
                	Album a = new Album(albumName);
                	ArrayList<Photo> tar = photosInAlbum;
                	for(int i=0;i<tar.size();i++) {
                		a.addPhoto(tar.get(i));
                	}
                	user.albums.add(a); // update the our backend
                	try {
    					Privacy.serialize();// send backend to cloud
    				} catch (IOException e) {
    					// TODO Auto-generated catch block
    					e.printStackTrace();
    				}
//    				createFolder(userSpace,albumName);
    				showMiniDialoge("Successful");
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
	 * We check whether given album exists already
	 * @param name : the name of the album we are checking
	 */
	public boolean checkExistence(String name) {
		// Checks if an album exists. If so, returns true
		if(user.albums==null || user.albums.size()<=0) {
			return false;
		}
		for (int i=0;i<user.albums.size();i++) {
			String albumName = user.albums.get(i).getAlbumName();
	        if (albumName.equals(name)) {
	            return true;
	        }
	    }
	    return false;
		
		
	}
	
}